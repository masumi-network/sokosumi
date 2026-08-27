import { SOKO_BOT_VERSIONS } from "@sokosumi/soko-bot";

import prisma from "@/lib/db/prisma";

const DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1_000;

export interface SokoBotQualityOverview {
  overall: { turns: number; judged: number; avgScore: number | null };
  /** Self-started turns that reached the owner, and how many they acted on within a day. */
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
    labRuns: number;
    labPassRate: number | null;
    labAvgJudge: number | null;
    labVerdicts: { pass: number; weak: number; fail: number };
  }[];
}

export interface SokoBotQualityOverviewOptions {
  versionId?: string;
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.round(mean * 100) / 100;
}

/** Fleet-wide judge scores over time and per version; lab runs per version. */
export async function getSokoBotQualityOverview(
  options: SokoBotQualityOverviewOptions = {},
): Promise<SokoBotQualityOverview> {
  const since = new Date(Date.now() - DAYS * DAY_MS);
  const [allTurns, labRuns] = await Promise.all([
    prisma.sokoBotTurn.findMany({
      where: {
        createdAt: { gte: since },
        status: { in: ["COMPLETED", "FAILED"] },
      },
      select: {
        createdAt: true,
        qualityScore: true,
        versionId: true,
        source: true,
        sokoBotId: true,
        finalAnswer: true,
        ownerFeedback: true,
        ownerFeedbackAt: true,
      },
    }),
    prisma.sokoBotLabRun.findMany({
      where: { createdAt: { gte: since } },
      select: { versionId: true, passed: true, total: true, judge: true },
    }),
  ]);

  const versionIds = new Set<string>([
    ...SOKO_BOT_VERSIONS.map((version) => version.id),
    ...allTurns.map((turn) => turn.versionId ?? "unknown"),
    ...labRuns.map((run) => run.versionId),
  ]);
  const selectedVersionId =
    options.versionId && versionIds.has(options.versionId)
      ? options.versionId
      : null;
  const turns = selectedVersionId
    ? allTurns.filter(
        (turn) => (turn.versionId ?? "unknown") === selectedVersionId,
      )
    : allTurns;

  const scoresByDay = new Map<string, number[]>();
  const turnsByDay = new Map<string, number>();
  for (const turn of turns) {
    const date = turn.createdAt.toISOString().slice(0, 10);
    turnsByDay.set(date, (turnsByDay.get(date) ?? 0) + 1);
    if (turn.qualityScore !== null) {
      scoresByDay.set(date, [
        ...(scoresByDay.get(date) ?? []),
        turn.qualityScore,
      ]);
    }
  }
  const proactiveTurns = turns.filter(
    (turn) =>
      turn.source !== "CHAT" &&
      turn.source !== "ADMIN_RETRY" &&
      turn.finalAnswer &&
      !/^nothing (new worth flagging|to add)\.?$/i.test(
        turn.finalAnswer.trim(),
      ),
  );
  const thumbsByDay = new Map<string, { up: number; down: number }>();
  for (const turn of proactiveTurns) {
    if (turn.ownerFeedbackAt === null || turn.ownerFeedback === null) continue;
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
    const versionTurns = allTurns.filter(
      (t) => (t.versionId ?? "unknown") === versionId,
    );
    const runs = labRuns.filter((r) => r.versionId === versionId);
    const verdicts = { pass: 0, weak: 0, fail: 0 };
    const judgeScores: number[] = [];
    for (const run of runs) {
      const judge = run.judge as {
        verdict?: "pass" | "weak" | "fail";
        scores?: Record<string, number>;
      } | null;
      if (judge?.verdict) verdicts[judge.verdict] += 1;
      const values = judge?.scores ? Object.values(judge.scores) : [];
      if (values.length) {
        judgeScores.push(values.reduce((a, b) => a + b, 0) / values.length);
      }
    }
    return {
      versionId,
      name: SOKO_BOT_VERSIONS.find((v) => v.id === versionId)?.name ?? null,
      turns: versionTurns.length,
      avgScore: avg(
        versionTurns.flatMap((t) =>
          t.qualityScore === null ? [] : [t.qualityScore],
        ),
      ),
      labRuns: runs.length,
      labPassRate:
        runs.length === 0
          ? null
          : Math.round(
              (runs.filter((r) => r.passed === r.total).length / runs.length) *
                100,
            ),
      labAvgJudge: avg(judgeScores),
      labVerdicts: verdicts,
    };
  });

  const judged = turns.flatMap((t) =>
    t.qualityScore === null ? [] : [t.qualityScore],
  );
  const chatTurns = turns.filter((t) => t.source === "CHAT");
  const actedOn = proactiveTurns.filter((p) =>
    chatTurns.some(
      (c) =>
        c.sokoBotId === p.sokoBotId &&
        c.createdAt > p.createdAt &&
        c.createdAt.getTime() - p.createdAt.getTime() <= DAY_MS,
    ),
  ).length;
  return {
    overall: {
      turns: turns.length,
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
