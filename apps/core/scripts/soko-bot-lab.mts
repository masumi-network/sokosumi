/**
 * Headless Soko Bot behaviour lab: runs the shared scenarios against the
 * local stack (Core + Eve + DB) and scores them, without the web UI.
 *
 * pnpm --filter core soko-bot:lab -- --label v1
 * pnpm --filter core soko-bot:lab -- --only ambiguous-request,coworker-question
 * pnpm --filter core soko-bot:lab -- --all-versions --label nightly
 * Requires a running Eve runtime and the same .env Core uses.
 */
import { writeFile } from "node:fs/promises";

import {
  evaluateScenario,
  SOKO_BOT_SCENARIOS,
  SOKO_BOT_VERSIONS,
  type SokoBotLabTurn,
  type SokoBotScenario,
} from "@sokosumi/soko-bot";

import prisma from "@/lib/db/prisma";
import { sokoBotControlPlane } from "@/services/soko-bot-control-plane.service";
import { sokoBotEventsSyncService } from "@/services/soko-bot-events-sync.service";
import { simulateSokoBotTaskEvent } from "@/services/soko-bot-lab.service";
import { judgeSokoBotLabTurn } from "@/services/soko-bot-lab-judge.service";

const args = process.argv.slice(2);
function flag(name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}
const label = flag("label") ?? "run";
const only = flag("only")
  ?.split(",")
  .map((s) => s.trim());
const userIdArg = flag("user") ?? process.env.SOKO_BOT_LAB_USER_ID;
const noJudge = args.includes("--no-judge");
const TURN_TIMEOUT_MS = 6 * 60_000;

async function resolveOwner() {
  const bot = await prisma.sokoBot.findFirst({
    where: { archivedAt: null, ...(userIdArg ? { userId: userIdArg } : {}) },
    select: { id: true, userId: true, name: true },
    orderBy: { createdAt: "asc" },
  });
  if (!bot) throw new Error("No active Soko Bot found");
  const workspace = await prisma.workspace.findFirst({
    where: { userId: bot.userId },
    select: { id: true },
  });
  if (!workspace) throw new Error("Owner has no personal workspace");
  return { bot, workspaceId: workspace.id };
}

async function loadTurn(
  turnId: string,
): Promise<
  SokoBotLabTurn & { durationMs: number | null; costUsd: number | null }
> {
  const turn = await prisma.sokoBotTurn.findUniqueOrThrow({
    where: { id: turnId },
    select: {
      status: true,
      route: true,
      userMessage: true,
      finalAnswer: true,
      durationMs: true,
      costUsdMicros: true,
      toolCalls: { select: { capability: true, status: true, result: true } },
      events: { select: { type: true, toolName: true } },
      delegations: { select: { id: true, taskId: true, jobId: true } },
      pendingDecisions: { select: { id: true, resultingEntityId: true } },
      contextSnapshot: { select: { packet: true } },
    },
  });
  const { pendingDecisions, contextSnapshot, ...rest } = turn;
  return {
    ...rest,
    decisions: pendingDecisions,
    contextPacket: contextSnapshot?.packet ?? null,
    costUsd:
      turn.costUsdMicros === null ? null : Number(turn.costUsdMicros) / 1e6,
  };
}

async function waitForTurn(turnId: string) {
  const deadline = Date.now() + TURN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const turn = await prisma.sokoBotTurn.findUnique({
      where: { id: turnId },
      select: { status: true },
    });
    if (turn && ["COMPLETED", "FAILED", "CANCELLED"].includes(turn.status))
      return;
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
  throw new Error(`Turn ${turnId} did not settle`);
}

async function startScenario(
  scenario: SokoBotScenario,
  owner: { bot: { userId: string }; workspaceId: string },
): Promise<string> {
  if (scenario.trigger) {
    const since = new Date(Date.now() - 5_000);
    const simulated = await simulateSokoBotTaskEvent({
      userId: owner.bot.userId,
      workspaceId: owner.workspaceId,
      status: scenario.trigger.status,
      comment: scenario.trigger.comment,
    });
    // Same code path the cron uses; it starts and reconciles the EVENT turn.
    await sokoBotEventsSyncService.syncDelegatedWork({
      abortSignal: new AbortController().signal,
      shouldContinue: () => true,
    });
    const turn = await prisma.sokoBotTurn.findFirst({
      where: {
        source: "EVENT",
        createdAt: { gte: since },
        userMessage: { contains: simulated.taskId },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (!turn) throw new Error("Events sync did not start a turn");
    return turn.id;
  }
  const started = await sokoBotControlPlane.startTurn({
    userId: owner.bot.userId,
    workspaceId: owner.workspaceId,
    clientTurnId: `lab:${scenario.id}:${crypto.randomUUID()}`,
    message: scenario.prompt,
  });
  if (started.reconciliationLeaseToken) {
    await sokoBotControlPlane
      .reconcileTurn(
        started.turnId,
        undefined,
        started.reconciliationLeaseToken,
      )
      .catch(() => undefined);
  }
  return started.turnId;
}

const owner = await resolveOwner();
const versionArg = flag("version");
const versionIds = args.includes("--all-versions")
  ? SOKO_BOT_VERSIONS.map((v) => v.id)
  : versionArg
    ? [versionArg]
    : [null];
const scenarios = SOKO_BOT_SCENARIOS.filter(
  (s) => !only || only.includes(s.id),
);
const rows: unknown[] = [];
for (const versionId of versionIds) {
  if (versionId) {
    await sokoBotControlPlane.updateVersion(owner.bot.userId, versionId);
    console.log(`=== version ${versionId}`);
  }
  console.log(
    `Lab "${label}" for bot ${owner.bot.name} (${scenarios.length} scenarios)`,
  );
  for (const scenario of scenarios) {
    const startedAt = Date.now();
    try {
      const turnId = await startScenario(scenario, owner);
      await waitForTurn(turnId);
      const turn = await loadTurn(turnId);
      const result = evaluateScenario(scenario, turn);
      const judged = noJudge
        ? null
        : await judgeSokoBotLabTurn({
            userId: owner.bot.userId,
            turnId,
            scenarioId: scenario.id,
            evaluation: {
              passed: result.passed,
              total: result.total,
              checks: result.checks,
            },
          }).catch((error) => {
            console.log(
              `     judge failed: ${error instanceof Error ? error.message : error}`,
            );
            return null;
          });
      const tools = Array.from(
        new Set(turn.toolCalls.map((c) => c.capability)),
      );
      rows.push({
        versionId,
        id: scenario.id,
        turnId,
        route: turn.route,
        passed: result.passed,
        total: result.total,
        durationMs: turn.durationMs,
        costUsd: turn.costUsd,
        tools,
        checks: result.checks,
        judge: judged?.verdict ?? null,
        answer: turn.finalAnswer,
      });
      const failed = result.checks
        .filter((c) => !c.pass)
        .map((c) => `${c.label} (${c.actual})`);
      if (judged?.verdict.issues.length) {
        failed.push(...judged.verdict.issues.map((issue) => `judge: ${issue}`));
      }
      const judgeLine = judged
        ? ` judge=${judged.verdict.verdict} d${judged.verdict.scores.delegation} f${judged.verdict.scores.followThrough} j${judged.verdict.scores.judgment} h${judged.verdict.scores.honesty}`
        : "";
      console.log(
        `${result.passed === result.total ? "PASS" : "FAIL"} ${scenario.id} ${result.passed}/${result.total} route=${turn.route} ${Math.round((turn.durationMs ?? 0) / 1000)}s $${(turn.costUsd ?? 0).toFixed(4)} tools=[${tools.join(",")}]${judgeLine}${failed.length ? `\n     ✗ ${failed.join("\n     ✗ ")}` : ""}`,
      );
    } catch (error) {
      rows.push({
        versionId,
        id: scenario.id,
        error: error instanceof Error ? error.message : String(error),
      });
      console.log(
        `ERR  ${scenario.id}: ${error instanceof Error ? error.message : error} (${Math.round((Date.now() - startedAt) / 1000)}s)`,
      );
    }
  }
}
const out = flag("out") ?? `soko-bot-lab-${label}.json`;
await writeFile(
  out,
  JSON.stringify({ label, at: new Date().toISOString(), rows }, null, 2),
);
console.log(`Wrote ${out}`);
await prisma.$disconnect();
process.exit(0);
