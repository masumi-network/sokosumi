/**
 * Benchmark world validation (B2, research2 R3-A): runs each owner journey
 * through the real runner and Core with no model, and checks the world and
 * the grader, not the bot.
 *
 *   1. A do-nothing agent ("OK", no tools) must FAIL the journey.
 *   2. The journey's reference script must PASS every check.
 *   3. Each journey runs twice in a row: every pass must give the same
 *      checks, and right after the runner's reset the lane must hold nothing
 *      from earlier work.
 *
 * Nothing asks a model: the agent and Jev answer from a script, the judge is
 * off, and every provider key is a dummy, so any other call fails loudly.
 * Held-out journeys print as counts only; per-case detail goes to --json-out.
 * Exits 1 when any journey fails a check, a run is invalid or a reference
 * script is missing.
 *
 *   pnpm --filter @sokosumi/core ownerbench:world-check --suite soko-bot
 *   pnpm --filter @sokosumi/core ownerbench:world-check --cases owner-pdf-to-x-posts --modes reference --passes 1
 */
import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    suite: { type: "string", multiple: true },
    cases: { type: "string" },
    modes: { type: "string", default: "noop,reference" },
    passes: { type: "string", default: "2" },
    holdout: { type: "string" },
    "json-out": { type: "string" },
    /** A private module whose default export, given SCRIPT_HELPERS, returns held-out scripts. */
    scripts: { type: "string" },
  },
});

type Mode = "noop" | "reference";
const MODES: readonly Mode[] = ["noop", "reference"];

/** An invocation that could reach a provider or a shared database never starts. */
function admissionProblem(): string | null {
  const modes = values.modes.split(",");
  const bad = modes.filter((mode) => !MODES.includes(mode as Mode));
  if (bad.length)
    return `Unknown mode(s): ${bad.join(", ")}; use noop,reference`;
  if (!(Number(values.passes) >= 1)) return "--passes must be 1 or more";
  if (process.env.VERCEL || process.env.NODE_ENV === "production")
    return "A world check runs locally only (VERCEL or NODE_ENV=production is set)";
  for (const key of ["DATABASE_URL", "DATABASE_URL_UNPOOLED"]) {
    const url = process.env[key];
    if (!url) return `${key} must point at a local database`;
    const host = new URL(url).hostname;
    if (!["localhost", "127.0.0.1", "::1"].includes(host))
      return `${key} points at ${host}; a world check runs on a local database only`;
  }
  return null;
}
const refused = admissionProblem();
if (refused) {
  console.error(refused);
  process.exit(2);
}

if (values.holdout) process.env.OWNERBENCH_HOLDOUT_FILE = values.holdout;
process.env.SOKO_BOT_RUNTIME_ADAPTER = "in-process";
process.env.SOKO_BOT_LOCAL_CHATGPT_PLAN = "";
// No model, media, search, mail or payment provider is reachable: a call to
// one fails loudly instead of spending or sending.
for (const key of [
  "AI_GATEWAY_API_KEY",
  "SOKO_BOT_AI_GATEWAY_API_KEY",
  "CMO_AI_GATEWAY_API_KEY",
  "PROJECT_MEMORY_AI_GATEWAY_API_KEY",
  "EVALS_AI_GATEWAY_API_KEY",
  "ANTHROPIC_API_KEY",
  "FAL_KEY",
  "EXA_API_KEY",
  "COMPOSIO_API_KEY",
  "ZERNIO_API_KEY",
  "RESEND_API_KEY",
  "STRIPE_SECRET_KEY",
])
  process.env[key] = "world-check-off";
for (const key of ["OPENROUTER_DEFAULT_API_KEY", "OPENROUTER_CHAT_API_KEY"])
  process.env[key] = "sk-or-world-check-off";

const { default: prisma } = await import("@/lib/db/prisma");
const { createEvalRun, tickEvalRuns } = await import(
  "@/services/evals/eval-runs.service"
);
const { EVAL_CASES } = await import("@/services/evals/eval-cases");
const {
  auditBeforeFirstStep,
  setReferenceScript,
  takeScriptErrors,
  worldCheckMode,
} = await import("@/lib/evals/world-check");
const { REFERENCE_SCRIPTS, SCRIPT_HELPERS } = await import(
  "@/lib/evals/reference-scripts"
);
if (values.scripts) {
  const { pathToFileURL } = await import("node:url");
  const { resolve } = await import("node:path");
  const privateScripts = await import(
    pathToFileURL(resolve(values.scripts)).href
  );
  Object.assign(REFERENCE_SCRIPTS, privateScripts.default(SCRIPT_HELPERS));
}
const { journeyProblems, resultInvalid } = await import(
  "@/lib/evals/world-check-verdict"
);
type WorldCheckCheck =
  import("@/lib/evals/world-check-verdict").WorldCheckCheck;
type WorldCheckRun = import("@/lib/evals/world-check-verdict").WorldCheckRun;
type ResultRun = import("@/lib/evals/world-check-verdict").WorldCheckResult;
const { HOLDOUT_PREFIX } = await import("@/services/evals/ownerbench/holdout");

const modes = values.modes.split(",") as Mode[];
const suites = values.suite as ("soko-bot" | "cmo")[] | undefined;
const named = values.cases?.split(",").map((id) => id.trim());
const journeys = EVAL_CASES.filter(
  (evalCase) =>
    evalCase.kind === "journey" &&
    (!suites || suites.includes(evalCase.suite)) &&
    (!named || named.includes(evalCase.id)),
);
const unknown = (named ?? []).filter(
  (id) => !journeys.some((journey) => journey.id === id),
);
if (unknown.length) {
  console.error(`Not an owner journey: ${unknown.join(", ")}`);
  process.exit(2);
}

if (
  (await prisma.evalRun.count({
    where: { status: { in: ["QUEUED", "RUNNING"] } },
  })) > 0
) {
  console.error(
    "An eval run is already queued or running on this database; point DATABASE_URL at your own.",
  );
  process.exit(2);
}

type Check = WorldCheckCheck;
interface CaseRun extends WorldCheckRun {
  /** Work this journey left unfinished when it ended (the next reset clears it). */
  atEnd: Record<string, number> | null;
}

const OPEN_TURNS = [
  "QUEUED",
  "STARTING",
  "RUNNING",
  "CANCEL_REQUESTED",
] as const;
const OPEN_IMAGE_JOBS = ["PENDING", "SUBMITTING", "QUEUED", "RUNNING"] as const;
const OPEN_POSTS = [
  "DRAFT",
  "NEEDS_APPROVAL",
  "SCHEDULED",
  "PUBLISHING",
] as const;

/** Earlier work on the lane's workspace: open things, and work made before the journey began. */
async function laneState(
  workspaceId: string,
  before: Date,
  exceptTurnId?: string,
): Promise<Record<string, number>> {
  const [turns, watches, imageJobs, posts, tables] = await Promise.all([
    prisma.sokoBotTurn.count({
      where: {
        workspaceId,
        status: { in: [...OPEN_TURNS] },
        ...(exceptTurnId ? { id: { not: exceptTurnId } } : {}),
      },
    }),
    prisma.sokoBotWatch.count({
      where: { status: "WAITING", sokoBot: { workspaceId } },
    }),
    prisma.projectImageJob.count({
      where: { workspaceId, status: { in: [...OPEN_IMAGE_JOBS] } },
    }),
    prisma.socialPost.count({
      where: {
        project: { workspaceId },
        createdAt: { lt: before },
        status: { in: [...OPEN_POSTS] },
      },
    }),
    prisma.dataTable.count({
      where: { workspaceId, createdAt: { lt: before } },
    }),
  ]);
  return {
    openTurns: turns,
    waitingWatches: watches,
    openImageJobs: imageJobs,
    earlierOpenPosts: posts,
    earlierTables: tables,
  };
}

async function runOnce(
  caseId: string,
  mode: Mode,
  pass: number,
): Promise<CaseRun> {
  process.env.OWNERBENCH_WORLD_CHECK = mode;
  if (worldCheckMode() !== mode)
    throw new Error(`The scripted runtime did not switch on (${mode})`);
  setReferenceScript(
    mode === "reference"
      ? (REFERENCE_SCRIPTS[caseId] ?? { turns: [] })
      : { turns: [] },
  );
  takeScriptErrors();
  const seen: {
    workspaceId: string | null;
    afterReset: Record<string, number> | null;
  } = { workspaceId: null, afterReset: null };
  const journeyStart = new Date();
  auditBeforeFirstStep(async (turnId) => {
    const turn = await prisma.sokoBotTurn.findUniqueOrThrow({
      where: { id: turnId },
      select: { workspaceId: true },
    });
    seen.workspaceId = turn.workspaceId;
    seen.afterReset = await laneState(turn.workspaceId, journeyStart, turnId);
  });
  const run = await createEvalRun({
    trigger: "MANUAL",
    caseIds: [caseId],
    repeats: 1,
    label: `world check, ${mode}, pass ${pass}`,
  });
  for (;;) {
    const tick = await tickEvalRuns();
    const { status } = await prisma.evalRun.findUniqueOrThrow({
      where: { id: run.id },
      select: { status: true },
    });
    if (tick.completed || (status !== "QUEUED" && status !== "RUNNING")) break;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  const rows = await prisma.evalResult.findMany({
    where: { runId: run.id },
    orderBy: { repeat: "asc" },
    select: {
      repeat: true,
      status: true,
      error: true,
      checks: true,
      finishedAt: true,
    },
  });
  // A script step that threw makes the run say nothing about the world.
  const scriptErrors = takeScriptErrors();
  const results = rows.map((row): ResultRun => {
    const checks = (row.checks ?? []) as unknown as Check[];
    return {
      repeat: row.repeat,
      checks,
      invalid: scriptErrors.length
        ? `script error: ${scriptErrors.join("; ").slice(0, 300)}`
        : resultInvalid({ ...row, checks }),
    };
  });
  return {
    mode,
    pass,
    results,
    afterReset: seen.afterReset,
    atEnd: seen.workspaceId
      ? await laneState(seen.workspaceId, new Date(0))
      : null,
  };
}

interface Verdict {
  caseId: string;
  heldOut: boolean;
  problems: string[];
  runs: CaseRun[];
}

const verdicts: Verdict[] = [];
for (const evalCase of journeys) {
  const runs: CaseRun[] = [];
  for (let pass = 1; pass <= Number(values.passes); pass += 1)
    for (const mode of modes) runs.push(await runOnce(evalCase.id, mode, pass));
  const problems = journeyProblems(runs, {
    modes,
    hasScript: Boolean(REFERENCE_SCRIPTS[evalCase.id]),
  });
  verdicts.push({
    caseId: evalCase.id,
    heldOut: evalCase.id.startsWith(HOLDOUT_PREFIX),
    problems,
    runs,
  });
}

for (const verdict of verdicts.filter((each) => !each.heldOut))
  console.log(
    `${verdict.caseId}: ${verdict.problems.length ? verdict.problems.join(" | ") : "ok"}`,
  );
const held = verdicts.filter((verdict) => verdict.heldOut);
if (held.length) {
  const count = (pattern: RegExp) =>
    held.filter((verdict) =>
      verdict.problems.some((problem) => pattern.test(problem)),
    ).length;
  console.log(
    `held-out: ${held.length} journeys; invalid runs ${count(/INVALID RUN/)}, do-nothing passes ${count(/do-nothing PASSES/)}, reference fails ${count(/reference FAILS/)}, uncovered ${count(/UNCOVERED/)}, passes differ ${count(/passes give different/)}, leftovers ${count(/left over|not checked/)}`,
  );
}
if (values["json-out"]) {
  await writeFile(values["json-out"], JSON.stringify(verdicts, null, 2));
  console.log(`Per-journey detail written to ${values["json-out"]}`);
}
process.exit(verdicts.some((verdict) => verdict.problems.length) ? 1 : 0);
