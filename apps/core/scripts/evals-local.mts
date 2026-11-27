/**
 * Run eval cases in this process against the database in `.env`, no Core
 * server or CLI login needed. With `--plan`, nothing reaches the AI Gateway:
 * OpenAI models run on your own ChatGPT plan (sign in first:
 * `pnpm chatgpt-plan:login`), Gemini/Claude checks and Jev run on a plan
 * stand-in, embeddings in process, the judge on Claude Code, and any other
 * Gateway call fails. See docs/agents/evals.md.
 *
 *   pnpm --filter @sokosumi/core evals:local --plan --cases ambiguous-request
 *   pnpm --filter @sokosumi/core evals:local --plan --suite cmo --cuso-version cmo-v23
 *   pnpm --filter @sokosumi/core evals:local --plan --ownerbench --suite soko-bot
 *   pnpm --filter @sokosumi/core evals:local --plan --ownerbench --judge per-item --holdout HELD.ts --splits SPLITS.json
 *   pnpm --filter @sokosumi/core evals:local --rejudge RUN_ID --judge per-item --holdout HELD.ts --splits SPLITS.json --json-out arm-b1.json
 */
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    plan: { type: "boolean", default: false },
    suite: { type: "string", multiple: true },
    cases: { type: "string" },
    /** The owner benchmark's journeys, of --suite when given. */
    ownerbench: { type: "boolean", default: false },
    repeats: { type: "string", default: "1" },
    "soko-bot-version": { type: "string" },
    "cuso-version": { type: "string" },
    /**
     * Write the run's report as JSON here, for ownerbench-compare and
     * ownerbench-parity. With held-out journeys it holds their per-case
     * results: the evaluator's private file, never shared or committed.
     */
    "json-out": { type: "string" },
    /** Only write the report of this finished run (with --json-out); prints nothing per case. */
    report: { type: "string" },
    /**
     * Re-score a finished owner-benchmark run under `--judge per-item` without
     * re-running bots or modifying Postgres; writes a ParityReport JSON to `--json-out`.
     */
    rejudge: { type: "string" },
    /**
     * Owner-benchmark judge mode: `holistic` (default) or `per-item` (3 votes
     * per frozen rubric item; dev splits in repo, held-out splits via `--splits`).
     */
    judge: { type: "string" },
    /**
     * Private held-out rubric splits (a JSON object keyed by journey id, or a
     * module exporting HELDOUT_RUBRIC_SPLITS), kept outside the repository.
     * Required when `--judge per-item` runs or re-judges held-out journeys.
     */
    splits: { type: "string" },
    /**
     * The held-out journeys' file (a JSON array, or a module exporting
     * HELDOUT_JOURNEYS), kept outside the repository; --ownerbench then runs
     * both sets, and stdout shows the held-out set as counts only.
     */
    holdout: { type: "string" },
  },
});

// Configure all env flags BEFORE importing any `@/` service or Prisma module so
// `getEnv()` never caches the paid Gateway default ahead of local CLI setup.
if (values.holdout) process.env.OWNERBENCH_HOLDOUT_FILE = values.holdout;
if (values.splits) process.env.OWNERBENCH_SPLITS_FILE = values.splits;
if (values.judge) process.env.OWNERBENCH_JUDGE_MODE = values.judge;
if (values.plan) {
  process.env.SOKO_BOT_LOCAL_CHATGPT_PLAN = "1";
  // Production routes with real Jev; the stand-in routes differently. Plan runs
  // ask real Jev through the .env key unless SOKO_BOT_PLAN_REAL_JEV=0.
  process.env.SOKO_BOT_PLAN_REAL_JEV ??= "1";
}

if (values.rejudge) {
  if (!values["json-out"]) throw new Error("--rejudge needs --json-out");
  const requestedJudge = values.judge ?? "per-item";
  if (requestedJudge !== "per-item")
    throw new Error("--rejudge currently supports only --judge per-item");
  const explicitRunner = process.env.SOKO_BOT_JUDGE_RUNNER?.trim();
  if (explicitRunner && explicitRunner !== "claude-code") {
    throw new Error(
      `--rejudge runs only on the local plan judge (claude-code), never "${explicitRunner}". Unset SOKO_BOT_JUDGE_RUNNER or set it to "claude-code".`,
    );
  }
  process.env.SOKO_BOT_JUDGE_RUNNER = "claude-code";
  process.env.OWNERBENCH_JUDGE_MODE = "per-item";
}

async function writeReportJson(report: unknown, path: string) {
  const { writeFile } = await import("node:fs/promises");
  await writeFile(
    path,
    JSON.stringify(report, (_key, value) =>
      typeof value === "bigint" ? Number(value) : value,
    ),
  );
  console.log(`Report written to ${path}`);
}

async function writeReport(runId: string, path: string) {
  const { getEvalRunReport } = await import(
    "@/services/evals/eval-runs.service"
  );
  await writeReportJson(await getEvalRunReport(runId), path);
}

if (values.report) {
  if (!values["json-out"]) throw new Error("--report needs --json-out");
  await writeReport(values.report, values["json-out"]);
  process.exit(0);
}

if (values.rejudge) {
  // Fail closed before touching DB or splits if the local Claude Code CLI is unavailable.
  const { assertClaudeCodeJudgeAvailable } = await import(
    "@/lib/soko-bot/claude-code-judge"
  );
  await assertClaudeCodeJudgeAvailable();
  const { default: prisma } = await import("@/lib/db/prisma");
  const { getEvalRunReport } = await import(
    "@/services/evals/eval-runs.service"
  );
  const { holdoutJourneys } = await import(
    "@/services/evals/ownerbench/holdout"
  );
  const { OWNER_JOURNEYS } = await import(
    "@/services/evals/ownerbench/journeys"
  );
  const { rejudgeEvalRunReport } = await import(
    "@/services/evals/ownerbench/per-item-judge"
  );
  const { runOutputLines } = await import(
    "@/services/evals/ownerbench/run-output"
  );
  const report = await getEvalRunReport(values.rejudge);
  const rescored = await rejudgeEvalRunReport({
    report,
    journeys: [...OWNER_JOURNEYS, ...holdoutJourneys()],
    onProgress: ({ completed, total, label, status }) => {
      console.log(`  [${completed}/${total}] ${label}\t${status}`);
    },
  });
  const flatResults = rescored.cases.flatMap((evalCase) => evalCase.results);
  for (const line of runOutputLines(flatResults)) console.log(line);
  if (values.holdout)
    console.log(
      "\nThe run holds held-out journeys: share only ownerbench-compare's totals, never per-case held-out output.",
    );
  await writeReportJson(rescored, values["json-out"]!);
  await prisma.$disconnect();
  process.exit(0);
}

const { ownerbenchJudgeMode } = await import(
  "@/services/evals/ownerbench/per-item-judge"
);
const judgeMode = ownerbenchJudgeMode();

// `--plan` or the env flag alone: either way this is a plan run.
const plan = ["1", "true"].includes(
  process.env.SOKO_BOT_LOCAL_CHATGPT_PLAN ?? "",
);
process.env.SOKO_BOT_RUNTIME_ADAPTER = "in-process";

const { default: prisma } = await import("@/lib/db/prisma");
const { createEvalRun, tickEvalRuns } = await import(
  "@/services/evals/eval-runs.service"
);
const { EVAL_CASES } = await import("@/services/evals/eval-cases");
const suites = values.suite as ("soko-bot" | "cmo")[] | undefined;
const caseIds = values.ownerbench
  ? EVAL_CASES.filter(
      (evalCase) =>
        evalCase.kind === "journey" &&
        (!suites || suites.includes(evalCase.suite)),
    ).map((evalCase) => evalCase.id)
  : values.cases?.split(",").map((id) => id.trim());
if (judgeMode === "per-item") {
  const { loadRubricSplitsForJourneys } = await import(
    "@/services/evals/ownerbench/rubric-splits"
  );
  const selectedCases = (caseIds ?? [])
    .map((id) => EVAL_CASES.find((evalCase) => evalCase.id === id))
    .filter((evalCase) => evalCase !== undefined);
  const journeyCases = selectedCases.filter(
    (evalCase) => evalCase.kind === "journey",
  );
  if (
    selectedCases.length === 0 ||
    journeyCases.length !== selectedCases.length
  ) {
    throw new Error(
      "--judge per-item applies only to owner-benchmark journeys (pass --ownerbench or owner-* --cases)",
    );
  }
  // Fail fast before queuing a run if any dev or held-out split is missing or stale.
  loadRubricSplitsForJourneys(journeyCases.map((evalCase) => evalCase.journey));
}
if (plan) {
  const { chatGptPlanAccessToken } = await import("@/lib/local-chatgpt-plan");
  await chatGptPlanAccessToken();
}

const busy = await prisma.evalRun.count({
  where: { status: { in: ["QUEUED", "RUNNING"] } },
});
if (busy > 0) {
  console.error(
    `${busy} eval run(s) already queued or running on this database. Runs share one queue, so this would tick someone else's run with your code. Wait for it, or point DATABASE_URL at your own database.`,
  );
  process.exit(1);
}

const git = (...args: string[]) =>
  execFileSync("git", args, { encoding: "utf8" }).trim();
const run = await createEvalRun({
  trigger: "MANUAL",
  suites,
  caseIds,
  repeats: Number(values.repeats),
  sokoBotVersionId: values["soko-bot-version"] ?? null,
  cusoVersionId: values["cuso-version"] ?? null,
  // Plan runs get their label from createEvalRun, however plan mode was set.
  label: plan ? undefined : "local, Gateway",
  commit: {
    sha: git("rev-parse", "HEAD"),
    message: git("log", "-1", "--format=%s"),
  },
});
console.log(`Run ${run.id} (${plan ? "ChatGPT plan" : "Gateway"})`);

for (;;) {
  const tick = await tickEvalRuns();
  const { status } = await prisma.evalRun.findUniqueOrThrow({
    where: { id: run.id },
    select: { status: true },
  });
  if (tick.completed || (status !== "QUEUED" && status !== "RUNNING")) break;
  await new Promise((resolve) => setTimeout(resolve, 10_000));
}

const results = await prisma.evalResult.findMany({
  where: { runId: run.id },
  orderBy: [{ repeat: "asc" }, { position: "asc" }],
  select: {
    caseId: true,
    repeat: true,
    status: true,
    durationMs: true,
    error: true,
    output: true,
  },
});
const { runOutputLines } = await import(
  "@/services/evals/ownerbench/run-output"
);
for (const line of runOutputLines(results)) console.log(line);
const { planJevMode, planJevStats } = await import("@/lib/plan-jev");
if (planJevMode() !== null) {
  const jev = planJevStats();
  const byJev = new Map<string, number>();
  for (const result of results) {
    const label =
      (result.output as { jev?: string | null } | null)?.jev ?? "unlabelled";
    byJev.set(label, (byJev.get(label) ?? 0) + 1);
  }
  console.log(
    `\nJev: ${jev.calls} real call(s), ${jev.failures} failed, $${jev.costUsd.toFixed(4)}; results by Jev: ${[...byJev].map(([label, count]) => `${label} ${count}`).join(", ")}${jev.standInWindows.length ? `; stand-in windows: ${jev.standInWindows.map((window) => `${window.from}–${window.to}`).join(", ")}` : ""}`,
  );
}
console.log(
  values.holdout
    ? "\nThe run holds held-out journeys: share only ownerbench-compare's totals, never `sokosumi evals show` output."
    : `\nDetails: sokosumi evals show ${run.id} --markdown --api-url <this Core>`,
);
if (values["json-out"]) await writeReport(run.id, values["json-out"]);
await prisma.$disconnect();
process.exit(0);
