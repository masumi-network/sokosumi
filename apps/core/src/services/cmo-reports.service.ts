import { randomUUID } from "node:crypto";
import type { Prisma } from "@sokosumi/database";
import {
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
  getCmoHireForUser,
} from "@/services/cmo-cuso.service";
import {
  parseCmoStrategy,
  parseHistory,
  saveCmoStrategy,
} from "@/services/cmo-strategy.service";
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
 * Project's latest update. A weekly or monthly report keeps the strategy as
 * it was before the first save of the same turn, so the owner can revert the
 * whole review from the card in one step.
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
      cmoHire: { select: { strategyHistory: true } },
    },
  });
  if (!bot?.cmoHire) throw new CmoNotFoundError("Cuso is not hired yet");
  const { sharedRoomId: roomId, projectId } = bot;
  if (!roomId || !projectId) {
    throw new CmoNotFoundError("Cuso has no shared room in a Project");
  }
  const update = cmoReportUpdateInputSchema.parse(input.update);
  const savedThisTurn = parseHistory(bot.cmoHire.strategyHistory).filter(
    (entry) => entry.turnId === input.turnId,
  );
  const report: CmoReport = {
    ...update,
    ...((update.kind === "weekly" || update.kind === "monthly") &&
    savedThisTurn.length > 0
      ? { previousStrategy: savedThisTurn[savedThisTurn.length - 1]?.strategy }
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
 * its card. Entries already handed to Social stay as they are now, so Pause
 * can still cancel their posts.
 */
export async function revertCmoUpdate(input: {
  userId: string;
  updateId: string;
}): Promise<void> {
  const hire = await getCmoHireForUser(input.userId);
  if (!hire) throw new CmoNotFoundError("Cuso is not hired yet");
  const message = await prisma.chatRoomMessage.findFirst({
    where: { id: input.updateId, ...cmoReportMessageWhere(hire.sokoBotId) },
    select: { id: true, createdAt: true, metadata: true },
  });
  const target = message ? readCmoReport(message.metadata) : null;
  const previous = parseCmoStrategy(target?.previousStrategy);
  if (!message || !target || !previous) {
    throw new CmoNotFoundError("Nothing to revert for this update");
  }
  if (target.revertedAt) return;
  // Entries handed to Social and entries the owner paused stay as they are.
  const kept = new Map(
    (parseCmoStrategy(hire.strategy)?.calendar ?? [])
      .filter((entry) => entry.socialPostId || entry.status === "skipped")
      .map((entry) => [entry.id, entry]),
  );
  const calendar = [
    ...previous.calendar.map((entry) => kept.get(entry.id) ?? entry),
    ...[...kept.values()].filter(
      (entry) => !previous.calendar.some((old) => old.id === entry.id),
    ),
  ].sort((left, right) => left.date.localeCompare(right.date));
  await saveCmoStrategy({ userId: input.userId }, { ...previous, calendar });
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
