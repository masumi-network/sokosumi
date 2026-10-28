import { randomUUID } from "node:crypto";
import type { Prisma } from "@sokosumi/database";
import {
  CMO_SOKO_BOT_VERSION_ID,
  type CmoReportUpdateInput,
  cmoReportUpdateInputSchema,
} from "@sokosumi/soko-bot";
import { RESULT_SNAPSHOTS_KEY } from "@/helpers/chat-result-metadata";
import {
  CMO_REPORT_KEY,
  CMO_REPORT_MESSAGE_PREFIX,
  type CmoReport,
  cmoReportCard,
  cmoReportMarkdown,
  cmoReportMessageWhere,
  readCmoReport,
} from "@/helpers/cmo-report-card";
import { jsonInput } from "@/helpers/prisma-json";
import prisma from "@/lib/db/prisma";
import { sanitizePersistedValue } from "@/lib/soko-bot/persisted-value";
import {
  chatResultAvailableSchema,
  chatResultSnapshotSchema,
} from "@/schemas/chat-result-preview.schema";
import {
  CmoNotFoundError,
  requireCuso,
  startCmoProduction,
} from "@/services/cmo-cuso.service";
import {
  approvedMarketingStrategy,
  approveMarketingStrategy,
  discardMarketingStrategy,
} from "@/services/marketing-strategy.service";
import { setProjectLatestUpdate } from "@/services/project-latest-update";

/** A report as CMO reads it: its card's message id and when it was posted. */
export type CmoUpdateRecord = CmoReport & { id: string; at: string };

function toRecord(message: {
  id: string;
  createdAt: Date;
  metadata: unknown;
}): CmoUpdateRecord | null {
  const report = readCmoReport(message.metadata);
  return report
    ? { ...report, id: message.id, at: message.createdAt.toISOString() }
    : null;
}

/** Cuso's reports, newest first, read from the cards in his shared room. */
export async function listCmoReports(
  sokoBotId: string,
  take: number,
  db: Prisma.TransactionClient = prisma,
): Promise<CmoUpdateRecord[]> {
  const messages = await db.chatRoomMessage.findMany({
    where: cmoReportMessageWhere(sokoBotId),
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, createdAt: true, metadata: true },
  });
  return messages.flatMap((message) => toRecord(message) ?? []);
}

/**
 * Posts Cuso's report as a result card in his shared room and makes it the
 * Project's latest update. A weekly or monthly report that wrote a new
 * strategy version keeps the version approved before it, so the owner can
 * revert the whole review from the card in one step.
 */
export async function reportCmoUpdate(
  input: {
    sokoBotId: string;
    turnId: string;
    toolCallId: string;
    update: CmoReportUpdateInput;
  },
  db: Prisma.TransactionClient = prisma,
): Promise<CmoUpdateRecord> {
  const bot = await db.sokoBot.findUnique({
    where: { id: input.sokoBotId },
    select: {
      workspaceId: true,
      projectId: true,
      sharedRoomId: true,
      versionId: true,
    },
  });
  if (bot?.versionId !== CMO_SOKO_BOT_VERSION_ID) {
    throw new CmoNotFoundError("Cuso is not hired yet");
  }
  const { sharedRoomId: roomId, projectId } = bot;
  if (!roomId || !projectId) {
    throw new CmoNotFoundError("Cuso has no shared room in a Project");
  }
  const update = cmoReportUpdateInputSchema.parse(input.update);
  const [wroteThisTurn, approved] =
    update.kind === "weekly" || update.kind === "monthly"
      ? await Promise.all([
          db.marketingStrategy.findFirst({
            where: { projectId, authorTurnId: input.turnId },
            select: { id: true },
          }),
          approvedMarketingStrategy(projectId, db),
        ])
      : [null, null];
  const report: CmoReport = {
    ...update,
    ...(wroteThisTurn && approved && approved.id !== wroteThisTurn.id
      ? { previousVersionId: approved.id, versionId: wroteThisTurn.id }
      : {}),
  };
  const id = randomUUID();
  const at = new Date();
  const snapshot = chatResultSnapshotSchema.parse({
    workspaceId: bot.workspaceId,
    reference: { kind: "cmo_report", id },
    data: chatResultAvailableSchema.parse({
      id: randomUUID(),
      state: "available",
      capturedAt: at,
      kind: "cmo_report",
      ...cmoReportCard(report, projectId),
    }),
  });
  const message = await db.chatRoomMessage.upsert({
    where: {
      roomId_clientMessageId: {
        roomId,
        clientMessageId: `${CMO_REPORT_MESSAGE_PREFIX}${input.turnId}:${input.toolCallId}`,
      },
    },
    create: {
      id,
      roomId,
      clientMessageId: `${CMO_REPORT_MESSAGE_PREFIX}${input.turnId}:${input.toolCallId}`,
      senderSokoBotId: input.sokoBotId,
      content: report.headline,
      createdAt: at,
      metadata: {
        [CMO_REPORT_KEY]: jsonInput(report),
        [RESULT_SNAPSHOTS_KEY]: sanitizePersistedValue([snapshot]),
        soko_bot: { turn_id: input.turnId },
      },
    },
    update: {},
    select: { id: true, createdAt: true, metadata: true },
  });
  await db.chatRoom.update({
    where: { id: roomId },
    data: { updatedAt: at },
  });
  await setProjectLatestUpdate(
    { projectId, markdown: cmoReportMarkdown(report), at },
    db,
  );
  const record = toRecord(message);
  if (!record) throw new CmoNotFoundError("The report card is unreadable");
  return record;
}

/**
 * Puts back the strategy a weekly review or monthly strategy replaced, from
 * its card: a version it wrote that still waits for approval is discarded;
 * an approved one gives way to the version that ran before it. The card is
 * marked reverted only when one of the two happened.
 */
export async function revertCmoUpdate(input: {
  userId: string;
  updateId: string;
}): Promise<void> {
  const cuso = await requireCuso({ userId: input.userId });
  const message = await prisma.chatRoomMessage.findFirst({
    where: { id: input.updateId, ...cmoReportMessageWhere(cuso.sokoBotId) },
    select: { id: true, createdAt: true, metadata: true },
  });
  const target = message ? readCmoReport(message.metadata) : null;
  if (!message || !target?.previousVersionId || !target.versionId) {
    throw new CmoNotFoundError("Nothing to revert for this update");
  }
  if (target.revertedAt) return;
  const written = await prisma.marketingStrategy.findFirst({
    where: { id: target.versionId, projectId: cuso.projectId },
    select: { approvedAt: true },
  });
  if (!written) {
    throw new CmoNotFoundError("Nothing to revert for this update");
  }
  if (written.approvedAt) {
    await approveMarketingStrategy({
      projectId: cuso.projectId,
      workspaceId: cuso.workspaceId,
      userId: input.userId,
      strategyId: target.previousVersionId,
    });
    // Already paying: the month put back is made right away.
    await startCmoProduction(cuso.sokoBotId);
  } else {
    await discardMarketingStrategy({
      projectId: cuso.projectId,
      workspaceId: cuso.workspaceId,
      userId: input.userId,
      strategyId: target.versionId,
    });
  }
  await prisma.chatRoomMessage.update({
    where: { id: message.id },
    data: {
      metadata: jsonInput({
        ...(message.metadata as Record<string, unknown>),
        [CMO_REPORT_KEY]: { ...target, revertedAt: new Date().toISOString() },
      }),
    },
  });
}
