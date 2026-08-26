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
  daily: { date: string; turns: number; avgScore: number | null }[];
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

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.round(mean * 100) / 100;
}

/** Fleet-wide judge scores over time and per version; lab runs per version. */
export async function getSokoBotQualityOverview(): Promise<SokoBotQualityOverview> {
  const since = new Date(Date.now() - DAYS * DAY_MS);
  const [turns, labRuns] = await Promise.all([
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
      },
    }),
    prisma.sokoBotLabRun.findMany({
      where: { createdAt: { gte: since } },
      select: { versionId: true, passed: true, total: true, judge: true },
    }),
  ]);

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
  const daily: SokoBotQualityOverview["daily"] = [];
  for (let i = DAYS - 1; i >= 0; i -= 1) {
    const date = new Date(Date.now() - i * DAY_MS).toISOString().slice(0, 10);
    daily.push({
      date,
      turns: turnsByDay.get(date) ?? 0,
      avgScore: avg(scoresByDay.get(date) ?? []),
    });
  }

  const versionIds = new Set<string>([
    ...SOKO_BOT_VERSIONS.map((v) => v.id),
    ...turns.map((t) => t.versionId ?? "unknown"),
    ...labRuns.map((r) => r.versionId),
  ]);
  const versions = Array.from(versionIds).map((versionId) => {
    const versionTurns = turns.filter(
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
  const proactiveTurns = turns.filter(
    (t) =>
      t.source !== "CHAT" &&
      t.source !== "ADMIN_RETRY" &&
      t.finalAnswer &&
      !/^nothing (new worth flagging|to add)\.?$/i.test(t.finalAnswer.trim()),
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
