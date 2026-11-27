/**
 * Benchmark world validation (B2, research2 R3-A): runs each owner journey
 * through the real runner and Core with no model, and checks the world and
 * the grader, not the bot.
 *
 *   1. A do-nothing agent ("OK", no tools) must FAIL the journey.
 *   2. The journey's reference script must PASS every check.
 *   3. Each journey runs twice in a row: the second pass must give the same
 *      checks, and nothing may be left running on the lane after it.
 *
 * Nothing asks a model: the agent and Jev answer from a script, the judge is
 * off, and the Gateway key is a dummy, so any other model call fails loudly.
 * Held-out journeys print as counts only; per-case detail goes to --json-out.
 *
 *   pnpm --filter @sokosumi/core exec tsx scripts/ownerbench-world-check.mts --suite soko-bot
 *   pnpm --filter @sokosumi/core exec tsx scripts/ownerbench-world-check.mts --cases owner-pdf-to-x-posts --modes noop
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
  },
});

if (values.holdout) process.env.OWNERBENCH_HOLDOUT_FILE = values.holdout;
process.env.SOKO_BOT_RUNTIME_ADAPTER = "in-process";
process.env.SOKO_BOT_LOCAL_CHATGPT_PLAN = "";
// No model, media, search, mail or payment provider is reachable: a call to
// one fails loudly instead of spending or sending. Set before `.env` loads,
// which never overrides what is already set.
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
const { setReferenceScript } = await import("@/lib/evals/world-check");
const { REFERENCE_SCRIPTS } = await import("@/lib/evals/reference-scripts");
const { HOLDOUT_PREFIX } = await import("@/services/evals/ownerbench/holdout");

type Mode = "noop" | "reference";
const modes = values.modes.split(",") as Mode[];
const suites = values.suite as ("soko-bot" | "cmo")[] | undefined;
const named = values.cases?.split(",").map((id) => id.trim());
const journeys = EVAL_CASES.filter(
  (evalCase) =>
    evalCase.kind === "journey" &&
    (!suites || suites.includes(evalCase.suite)) &&
    (!named || named.includes(evalCase.id)),
);

if (
  (await prisma.evalRun.count({
    where: { status: { in: ["QUEUED", "RUNNING"] } },
  })) > 0
) {
  console.error(
    "An eval run is already queued or running on this database; point DATABASE_URL at your own.",
  );
  process.exit(1);
}

interface Check {
  label: string;
  pass: boolean;
  actual?: string;
}

interface CaseRun {
  mode: Mode;
  pass: number;
  status: string;
  error: string | null;
  checks: Check[];
  leftovers: Record<string, number>;
}

/** What a finished journey left running, for the next journey's reset to clear. */
async function leftovers(since: Date): Promise<Record<string, number>> {
  const createdAt = { gte: since };
  const [turns, watches, imageJobs] = await Promise.all([
    prisma.sokoBotTurn.count({
      where: { createdAt, status: { in: ["QUEUED", "STARTING", "RUNNING"] } },
    }),
    prisma.sokoBotWatch.count({ where: { createdAt, status: "WAITING" } }),
    prisma.projectImageJob.count({
      where: { createdAt, status: { in: ["QUEUED", "RUNNING"] } },
    }),
  ]);
  return {
    activeTurns: turns,
    waitingWatches: watches,
    openImageJobs: imageJobs,
  };
}

async function runOnce(
  caseId: string,
  mode: Mode,
  pass: number,
): Promise<CaseRun> {
  process.env.OWNERBENCH_WORLD_CHECK = mode;
  setReferenceScript(
    mode === "reference"
      ? (REFERENCE_SCRIPTS[caseId] ?? { turns: [] })
      : { turns: [] },
  );
  const startedAt = new Date();
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
  const result = await prisma.evalResult.findFirstOrThrow({
    where: { runId: run.id },
    select: { status: true, error: true, checks: true },
  });
  return {
    mode,
    pass,
    status: result.status,
    error: result.error,
    checks: (result.checks ?? []) as unknown as Check[],
    leftovers: await leftovers(startedAt),
  };
}

const allPass = (checks: readonly Check[]) =>
  checks.length > 0 && checks.every((check) => check.pass);
const signature = (checks: readonly Check[]) =>
  checks.map((check) => `${check.label}:${check.pass}`).join("|");

interface Verdict {
  caseId: string;
  heldOut: boolean;
  /** Check 1: the do-nothing run passes. */
  noopPasses: boolean | null;
  /** The checks a do-nothing run passes (negative checks are expected here). */
  noopPassing: string[];
  /** Check 2: the reference run fails, with the checks it fails. */
  referenceFails: string[] | null;
  /** Check 3: a mode whose second pass gave different checks. */
  notRepeatable: string[];
  leftovers: Record<string, number>;
  runs: CaseRun[];
}

const verdicts: Verdict[] = [];
for (const evalCase of journeys) {
  const runs: CaseRun[] = [];
  for (let pass = 1; pass <= Number(values.passes); pass += 1)
    for (const mode of modes) runs.push(await runOnce(evalCase.id, mode, pass));
  const first = (mode: Mode) => runs.find((run) => run.mode === mode);
  const noop = first("noop");
  const reference = first("reference");
  const leftover: Record<string, number> = {};
  for (const run of runs)
    for (const [key, count] of Object.entries(run.leftovers))
      leftover[key] = Math.max(leftover[key] ?? 0, count);
  verdicts.push({
    caseId: evalCase.id,
    heldOut: evalCase.id.startsWith(HOLDOUT_PREFIX),
    noopPasses: noop ? allPass(noop.checks) : null,
    noopPassing:
      noop?.checks.filter((check) => check.pass).map((check) => check.label) ??
      [],
    referenceFails: reference
      ? reference.checks
          .filter((check) => !check.pass)
          .map((check) => `${check.label} => ${check.actual ?? ""}`)
      : null,
    notRepeatable: modes.filter((mode) => {
      const [a, b] = runs.filter((run) => run.mode === mode);
      return a && b && signature(a.checks) !== signature(b.checks);
    }),
    leftovers: leftover,
    runs,
  });
}

const dev = verdicts.filter((verdict) => !verdict.heldOut);
for (const verdict of dev) {
  const problems = [
    verdict.noopPasses ? "do-nothing PASSES (checks too loose)" : null,
    verdict.referenceFails?.length
      ? `reference FAILS: ${verdict.referenceFails.join("; ")}`
      : null,
    verdict.notRepeatable.length
      ? `second pass differs (${verdict.notRepeatable.join(", ")})`
      : null,
    Object.values(verdict.leftovers).some(Boolean)
      ? `left running: ${JSON.stringify(verdict.leftovers)}`
      : null,
  ].filter(Boolean);
  console.log(
    `${verdict.caseId}: ${problems.length ? problems.join(" | ") : "ok"}`,
  );
}
const held = verdicts.filter((verdict) => verdict.heldOut);
if (held.length)
  console.log(
    `held-out: ${held.length} journeys; do-nothing passes ${held.filter((v) => v.noopPasses).length}, reference fails ${held.filter((v) => v.referenceFails?.length).length}, second pass differs ${held.filter((v) => v.notRepeatable.length).length}, left running ${held.filter((v) => Object.values(v.leftovers).some(Boolean)).length}`,
  );
if (values["json-out"]) {
  await writeFile(values["json-out"], JSON.stringify(verdicts, null, 2));
  console.log(`Per-journey detail written to ${values["json-out"]}`);
}
process.exit(0);
