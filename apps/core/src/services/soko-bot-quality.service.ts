import type { SokoBotTurnSource } from "@sokosumi/database";
import { isSokoBotSilentAnswer, SOKO_BOT_VERSIONS } from "@sokosumi/soko-bot";
import { z } from "zod";
import { DAY_MS } from "@/config/constants";
import prisma from "@/lib/db/prisma";

const receiptIdSchema = z.uuid();

const DAYS = 30;

export interface SokoBotQualityOverview {
  overall: { turns: number; judged: number; avgScore: number | null };
  /** Self-started turns that reached the owner, and how many they acted on within a day. */
  reliability: {
    fulfillment: Record<string, number>;
    delivery: Record<string, number>;
    invalidActionClaims: number;
  };
  proactive: {
    sent: number;
    actedOn: number;
    thumbsUp: number;
    thumbsDown: number;
  };
  daily: {
    date: string;
    turns: number;
    avgScore: number | null;
    thumbsUp: number;
    thumbsDown: number;
  }[];
  versions: {
    versionId: string;
    name: string | null;
    turns: number;
    avgScore: number | null;
  }[];
}

export interface SokoBotQualityOverviewOptions {
  versionId?: string;
  /** Scope to one bot, for its operator status page. */
  sokoBotId?: string;
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.round(mean * 100) / 100;
}

function isProactiveTurn(turn: {
  finalAnswer: string | null;
  source: SokoBotTurnSource;
}): boolean {
  if (
    turn.source === "CHAT" ||
    turn.source === "ADMIN_RETRY" ||
    !turn.finalAnswer
  ) {
    return false;
  }
  return !isSokoBotSilentAnswer(turn.finalAnswer);
}

/** Real-run judge scores and owner feedback over time and per version. */
export async function getSokoBotQualityOverview(
  options: SokoBotQualityOverviewOptions = {},
): Promise<SokoBotQualityOverview> {
  const since = new Date(Date.now() - DAYS * DAY_MS);
  const candidateTurns = await prisma.sokoBotTurn.findMany({
    where: {
      status: { in: ["COMPLETED", "FAILED"] },
      NOT: { clientTurnId: { startsWith: "lab:" } },
      OR: [{ createdAt: { gte: since } }, { ownerFeedbackAt: { gte: since } }],
      ...(options.sokoBotId ? { sokoBotId: options.sokoBotId } : {}),
    },
    select: {
      id: true,
      workspaceId: true,
      intentId: true,
      intentRevision: true,
      fulfillmentState: true,
      deliveries: { select: { status: true } },
      responseContract: true,
      createdAt: true,
      qualityScore: true,
      versionId: true,
      source: true,
      sokoBotId: true,
      finalAnswer: true,
      ownerFeedback: true,
      ownerFeedbackAt: true,
    },
  });
  const recentTurns = candidateTurns.filter((turn) => turn.createdAt >= since);

  const versionIds = new Set<string>([
    ...SOKO_BOT_VERSIONS.map((version) => version.id),
    ...recentTurns.map((turn) => turn.versionId ?? "unknown"),
  ]);
  const selectedVersionId = options.versionId ?? null;
  const panelTurns = selectedVersionId
    ? recentTurns.filter(
        (turn) => (turn.versionId ?? "unknown") === selectedVersionId,
      )
    : recentTurns;
  const panelFeedbackTurns = selectedVersionId
    ? candidateTurns.filter(
        (turn) => (turn.versionId ?? "unknown") === selectedVersionId,
      )
    : candidateTurns;

  const scoresByDay = new Map<string, number[]>();
  const turnsByDay = new Map<string, number>();
  for (const turn of panelTurns) {
    const date = turn.createdAt.toISOString().slice(0, 10);
    turnsByDay.set(date, (turnsByDay.get(date) ?? 0) + 1);
    if (turn.qualityScore !== null) {
      scoresByDay.set(date, [
        ...(scoresByDay.get(date) ?? []),
        turn.qualityScore,
      ]);
    }
  }
  const proactiveTurns = panelTurns.filter(
    (turn) =>
      isProactiveTurn(turn) &&
      turn.deliveries.some(
        (item) => item.status === "PERSISTED" || item.status === "PUBLISHED",
      ),
  );
  const thumbsByDay = new Map<string, { up: number; down: number }>();
  for (const turn of panelFeedbackTurns) {
    if (
      !isProactiveTurn(turn) ||
      turn.ownerFeedbackAt === null ||
      turn.ownerFeedbackAt < since ||
      turn.ownerFeedback === null
    ) {
      continue;
    }
    const date = turn.ownerFeedbackAt.toISOString().slice(0, 10);
    const thumbs = thumbsByDay.get(date) ?? { up: 0, down: 0 };
    if (turn.ownerFeedback === 1) thumbs.up += 1;
    if (turn.ownerFeedback === -1) thumbs.down += 1;
    thumbsByDay.set(date, thumbs);
  }
  const daily: SokoBotQualityOverview["daily"] = [];
  for (let i = DAYS - 1; i >= 0; i -= 1) {
    const date = new Date(Date.now() - i * DAY_MS).toISOString().slice(0, 10);
    daily.push({
      date,
      turns: turnsByDay.get(date) ?? 0,
      avgScore: avg(scoresByDay.get(date) ?? []),
      thumbsUp: thumbsByDay.get(date)?.up ?? 0,
      thumbsDown: thumbsByDay.get(date)?.down ?? 0,
    });
  }

  const versions = Array.from(versionIds).map((versionId) => {
    const versionTurns = recentTurns.filter(
      (t) => (t.versionId ?? "unknown") === versionId,
    );
    return {
      versionId,
      name: SOKO_BOT_VERSIONS.find((v) => v.id === versionId)?.name ?? null,
      turns: versionTurns.length,
      avgScore: avg(
        versionTurns.flatMap((t) =>
          t.qualityScore === null ? [] : [t.qualityScore],
        ),
      ),
    };
  });

  const judged = panelTurns.flatMap((t) =>
    t.qualityScore === null ? [] : [t.qualityScore],
  );
  const chatTurns = panelTurns.filter((t) => t.source === "CHAT");
  const actedOn = proactiveTurns.filter((p) =>
    chatTurns.some(
      (c) =>
        c.sokoBotId === p.sokoBotId &&
        c.createdAt > p.createdAt &&
        c.createdAt.getTime() - p.createdAt.getTime() <= DAY_MS,
    ),
  ).length;
  const fulfillment: Record<string, number> = {};
  const delivery: Record<string, number> = {};
  let invalidActionClaims = 0;
  for (const turn of panelTurns) {
    const outcome = turn.fulfillmentState ?? "UNKNOWN";
    fulfillment[outcome] = (fulfillment[outcome] ?? 0) + 1;
    for (const status of turn.deliveries.length
      ? turn.deliveries.map((item) => item.status)
      : ["UNTRACKED"]) {
      delivery[status] = (delivery[status] ?? 0) + 1;
    }
    const contract = turn.responseContract;
    if (
      contract &&
      typeof contract === "object" &&
      !Array.isArray(contract) &&
      Array.isArray(contract.appliedReceiptIds)
    ) {
      const verified = new Set<string>();
      const claimed = [
        ...new Set(
          contract.appliedReceiptIds.filter(
            (id): id is string =>
              typeof id === "string" && receiptIdSchema.safeParse(id).success,
          ),
        ),
      ];
      // Fetch only claimed proof, in bounded batches; ordinary/read tool history
      // is irrelevant to this metric and must not be materialized for the panel.
      for (let offset = 0; offset < claimed.length; offset += 100) {
        const sources = await prisma.sokoBotToolCall.findMany({
          where: {
            id: { in: claimed.slice(offset, offset + 100) },
            actorBotId: turn.sokoBotId,
            status: "COMPLETED",
            disposition: { in: ["APPLIED", "ALREADY_SATISFIED"] },
            verification: { not: "NONE" },
            committedAt: { not: null },
            targetId: { not: null },
            turn: { sokoBotId: turn.sokoBotId, workspaceId: turn.workspaceId },
          },
          take: 100,
          select: {
            id: true,
            actorBotId: true,
            capability: true,
            inputHash: true,
            turn: {
              select: {
                id: true,
                sokoBotId: true,
                workspaceId: true,
                intentId: true,
                intentRevision: true,
              },
            },
          },
        });
        const replaySources = sources.filter(
          (source) =>
            source.actorBotId === turn.sokoBotId &&
            source.turn.sokoBotId === turn.sokoBotId &&
            source.turn.workspaceId === turn.workspaceId &&
            turn.intentId !== null &&
            source.turn.intentId === turn.intentId &&
            source.turn.intentRevision === turn.intentRevision,
        );
        for (const source of sources)
          if (source.turn.id === turn.id) verified.add(source.id);
        if (!replaySources.length) continue;
        let cursor: string | undefined;
        while (true) {
          const wrappers = await prisma.sokoBotToolCall.findMany({
            where: {
              turnId: turn.id,
              replayedReceiptId: {
                in: replaySources.map((source) => source.id),
              },
              ...(cursor ? { id: { gt: cursor } } : {}),
            },
            orderBy: { id: "asc" },
            take: 100,
            select: {
              id: true,
              replayedReceiptId: true,
              capability: true,
              inputHash: true,
            },
          });
          for (const call of wrappers) {
            const source = replaySources.find(
              (source) =>
                source.id === call.replayedReceiptId &&
                source.capability === call.capability &&
                source.inputHash === call.inputHash,
            );
            if (source) verified.add(source.id);
          }
          if (wrappers.length < 100) break;
          cursor = wrappers.at(-1)?.id;
        }
      }
      invalidActionClaims += contract.appliedReceiptIds.filter(
        (id) => typeof id !== "string" || !verified.has(id),
      ).length;
    }
  }
  return {
    reliability: { fulfillment, delivery, invalidActionClaims },
    overall: {
      turns: panelTurns.length,
      judged: judged.length,
      avgScore: avg(judged),
    },
    proactive: {
      sent: proactiveTurns.length,
      actedOn,
      thumbsUp: proactiveTurns.filter((t) => t.ownerFeedback === 1).length,
      thumbsDown: proactiveTurns.filter((t) => t.ownerFeedback === -1).length,
    },
    daily,
    versions: versions.sort((a, b) => a.versionId.localeCompare(b.versionId)),
  };
}
