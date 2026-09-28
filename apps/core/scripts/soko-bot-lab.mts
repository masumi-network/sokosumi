/**
 * Headless Soko Bot behaviour lab: runs the shared scenarios against the
 * local stack (Core + DB, turns in the sandbox or in process) and scores
 * them, without the web UI.
 *
 * pnpm --filter core soko-bot:lab -- --label v1
 * pnpm --filter core soko-bot:lab -- --only ambiguous-request,coworker-question
 * pnpm --filter core soko-bot:lab -- --all-versions --label nightly
 * Requires a running Core and the same .env Core uses. Point it at a lab
 * bot: --reset clears the Tasks, schedules, files and memory lab turns made.
 */

import { writeFile } from "node:fs/promises";
import {
  evaluateScenario,
  SOKO_BOT_SCENARIOS,
  SOKO_BOT_SYSTEM_SCHEDULES,
  type SokoBotScenario,
} from "@sokosumi/soko-bot";
import { del } from "@vercel/blob";
import { resolveWorkspaceForContextOrNotFound } from "@/helpers/personal-workspace-error";
import prisma from "@/lib/db/prisma";
import {
  SYSTEM_TURN_ROUTES,
  systemScheduleRoute,
} from "@/lib/soko-bot/system-routes";
import { tombstoneDriveUploadResources } from "@/services/file-catalog.service";
import { sokoBotControlPlane } from "@/services/soko-bot-control-plane.service";
import { buildIngestDeltaMessageForBot } from "@/services/soko-bot-ingest.service";
import { simulateSokoBotTaskEvent } from "@/services/soko-bot-lab.service";
import { judgeSokoBotLabTurn } from "@/services/soko-bot-lab-judge.service";
import { buildSystemBeatMessage } from "@/services/soko-bot-proactive.service";
import { createSokoBotSchedule } from "@/services/soko-bot-schedule.service";
import { listSokoBotVersions } from "@/services/soko-bot-version.service";

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
// Composio seam: record real responses to disk, or replay them without OAuth.
if (args.includes("--record"))
  process.env.SOKO_BOT_INTEGRATION_FIXTURES = "record";
if (args.includes("--replay"))
  process.env.SOKO_BOT_INTEGRATION_FIXTURES = "replay";
const workspaceIdArg = flag("workspace");
const noJudge = args.includes("--no-judge");
// Every run otherwise inherits the Tasks and schedules earlier runs created,
// and a bot that rightly declines to duplicate them scores as a failure.
const reset = args.includes("--reset");
// A turn may run until its 15-minute deadline; giving up sooner scores a slow
// but valid turn as an error and fails the next scenario on a busy bot.
const TURN_TIMEOUT_MS = 16 * 60_000;
/** A dropped or stalled database connection, retried once: not the bot's doing. */
const DATABASE_BLIP =
  /Can't reach database server|Connection terminated unexpectedly|expired transaction|P1001|P1017|P2028/;

async function resolveOwner() {
  const bot = await prisma.sokoBot.findFirst({
    where: {
      archivedAt: null,
      ...(userIdArg ? { userId: userIdArg } : {}),
      ...(workspaceIdArg ? { workspaceId: workspaceIdArg } : {}),
    },
    select: { id: true, userId: true, workspaceId: true, name: true },
    orderBy: { createdAt: "asc" },
  });
  if (!bot) throw new Error("No active Soko Bot found");
  return { bot, workspaceId: bot.workspaceId };
}

/**
 * Puts the bot back to the same starting point for every version: archives
 * the Tasks lab turns created (older runtimes recorded some only as
 * delegations), removes lab and seeded schedules and lab Drive files, and
 * clears memory. Work the owner started in real chats is left alone.
 */
async function resetLabState(owner: {
  bot: { id: string; userId: string };
  workspaceId: string;
}) {
  const labTurn = {
    sokoBotId: owner.bot.id,
    clientTurnId: { startsWith: "lab:" },
  };
  const created = await prisma.sokoBotToolCall.findMany({
    where: {
      capability: { in: ["create_task", "create_schedule", "upload_file"] },
      status: "COMPLETED",
      targetId: { not: null },
      turn: labTurn,
    },
    select: { capability: true, targetId: true },
  });
  const delegated = await prisma.sokoBotDelegation.findMany({
    where: { action: "create_task", taskId: { not: null }, turn: labTurn },
    select: { taskId: true },
  });
  const ids = (capability: string) =>
    created.flatMap((call) =>
      call.capability === capability && call.targetId ? [call.targetId] : [],
    );
  const tasks = await prisma.task.updateMany({
    where: {
      id: {
        in: [
          ...ids("create_task"),
          ...delegated.flatMap((d) => (d.taskId ? [d.taskId] : [])),
        ],
      },
      archivedAt: null,
    },
    data: { archivedAt: new Date() },
  });
  const seeded = SOKO_BOT_SCENARIOS.flatMap((scenario) =>
    (scenario.setup?.schedules ?? []).map((schedule) => schedule.name),
  );
  const schedules = await prisma.sokoBotSchedule.deleteMany({
    where: {
      sokoBotId: owner.bot.id,
      systemKey: null,
      OR: [{ id: { in: ids("create_schedule") } }, { name: { in: seeded } }],
    },
  });
  const files = ids("upload_file").filter((url) => url.startsWith("https://"));
  if (files.length) {
    await del(files);
    // The catalog entry goes with the bytes, as a Drive delete does, or the
    // next version still finds and reads a file that no longer exists.
    const workspace = await resolveWorkspaceForContextOrNotFound(
      owner.bot.userId,
      null,
      prisma,
    );
    await tombstoneDriveUploadResources({
      workspaceId: workspace.id,
      scope: "user",
      pathnames: files.map((url) =>
        decodeURIComponent(new URL(url).pathname.slice(1)),
      ),
    });
  }
  await sokoBotControlPlane.resetMemory(owner.bot.userId, owner.workspaceId);
  console.log(
    `Reset: archived ${tasks.count} task(s), removed ${schedules.count} schedule(s) and ${files.length} file(s), cleared memory`,
  );
}

async function loadTurn(turnId: string) {
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
      delegations: {
        select: {
          id: true,
          taskId: true,
          jobId: true,
          action: true,
          outcome: true,
        },
      },
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

/**
 * The taskboard and event syncs wake the bot about Tasks the lab itself
 * creates; a scenario started while such a turn runs is refused as busy.
 * Wait for the bot to settle before each scenario.
 */
async function waitForIdle(sokoBotId: string, timeoutMs = TURN_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const active = await prisma.sokoBotTurn.count({
      where: {
        sokoBotId,
        status: { in: ["QUEUED", "STARTING", "RUNNING", "CANCEL_REQUESTED"] },
      },
    });
    if (active === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error("Soko Bot did not become idle in time");
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
  owner: { bot: { id: string; userId: string }; workspaceId: string },
): Promise<string> {
  if (scenario.trigger?.kind === "ingest") {
    const bot = await prisma.sokoBot.findFirstOrThrow({
      where: { userId: owner.bot.userId, workspaceId: owner.workspaceId },
      select: {
        id: true,
        userId: true,
        workspaceId: true,
        ingestTimezone: true,
        followWholeBoard: true,
      },
    });
    const beat = scenario.trigger.beat;
    const message =
      beat === "delta"
        ? await buildIngestDeltaMessageForBot(bot.id)
        : (
            await buildSystemBeatMessage({
              bot: {
                id: bot.id,
                userId: bot.userId,
                workspaceId: bot.workspaceId,
                ingestTimezone: bot.ingestTimezone,
                followWholeBoard: bot.followWholeBoard,
              },
              key: beat,
              prompt:
                SOKO_BOT_SYSTEM_SCHEDULES.find((s) => s.key === beat)?.prompt ??
                "Daily stand-up.",
              now: new Date(),
            })
          ).message;
    const started = await sokoBotControlPlane.startTurn({
      userId: owner.bot.userId,
      workspaceId: owner.workspaceId,
      clientTurnId: `lab:${scenario.id}:${crypto.randomUUID()}`,
      message,
      source: beat === "delta" ? "INGEST" : "SCHEDULE",
      // The route the cron grants, not a classifier guess from Core's own prompt.
      presetRoute:
        beat === "delta"
          ? SYSTEM_TURN_ROUTES["ingest:delta"]
          : systemScheduleRoute(beat),
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
  if (scenario.trigger?.kind === "task_event") {
    // The simulation starts the turn and returns it. It used to run the
    // events sync instead — a global scan that woke every owner's pending
    // delegations and spent their allowances to score one scenario here.
    // Only ever a Task a lab turn created: falling back to the bot's newest
    // delegation posted fake Coworker events onto the owner's real work.
    const labTask = await prisma.sokoBotDelegation.findFirst({
      where: {
        action: "create_task",
        turn: {
          sokoBotId: owner.bot.id,
          clientTurnId: { startsWith: "lab:" },
        },
        task: { archivedAt: null },
      },
      orderBy: { createdAt: "desc" },
      select: { taskId: true },
    });
    if (!labTask?.taskId)
      throw new Error("No lab-created Task to simulate Coworker activity on");
    const simulated = await simulateSokoBotTaskEvent({
      userId: owner.bot.userId,
      workspaceId: owner.workspaceId,
      taskId: labTask.taskId,
      status: scenario.trigger.status,
      comment: scenario.trigger.comment,
    });
    return simulated.turnId;
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
  ? // Built-ins plus anything authored in the console.
    (await listSokoBotVersions()).map((v) => v.id)
  : versionArg
    ? [versionArg]
    : [null];
const scenarios = SOKO_BOT_SCENARIOS.filter(
  (s) => !only || only.includes(s.id),
);
const rows: unknown[] = [];
for (const versionId of versionIds) {
  if (reset) await resetLabState(owner);
  if (versionId) {
    await sokoBotControlPlane.updateVersion(
      owner.bot.userId,
      owner.workspaceId,
      versionId,
    );
    console.log(`=== version ${versionId}`);
  }
  console.log(
    `Lab "${label}" for bot ${owner.bot.name} (${scenarios.length} scenarios)`,
  );
  for (const scenario of scenarios) {
    for (let attempt = 1; ; attempt++) {
      const startedAt = Date.now();
      try {
        await waitForIdle(owner.bot.id);
        if (scenario.setup) {
          await resetLabState(owner);
          for (const schedule of scenario.setup.schedules ?? [])
            await createSokoBotSchedule({
              userId: owner.bot.userId,
              workspaceId: owner.workspaceId,
              timezone: "Europe/Berlin",
              ...schedule,
            });
        }
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
          failed.push(
            ...judged.verdict.issues.map((issue) => `judge: ${issue}`),
          );
        }
        const judgeLine = judged
          ? ` judge=${judged.verdict.verdict} d${judged.verdict.scores.delegation} f${judged.verdict.scores.followThrough} j${judged.verdict.scores.judgment} h${judged.verdict.scores.honesty}`
          : "";
        console.log(
          `${result.passed === result.total ? "PASS" : "FAIL"} ${scenario.id} ${result.passed}/${result.total} route=${turn.route} ${Math.round((turn.durationMs ?? 0) / 1000)}s $${(turn.costUsd ?? 0).toFixed(4)} tools=[${tools.join(",")}]${judgeLine}${failed.length ? `\n     ✗ ${failed.join("\n     ✗ ")}` : ""}`,
        );
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (attempt === 1 && DATABASE_BLIP.test(message)) {
          console.log(`RETRY ${scenario.id}: the database connection dropped`);
          continue;
        }
        rows.push({ versionId, id: scenario.id, error: message });
        console.log(
          `ERR  ${scenario.id}: ${message} (${Math.round((Date.now() - startedAt) / 1000)}s)`,
        );
        break;
      }
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
