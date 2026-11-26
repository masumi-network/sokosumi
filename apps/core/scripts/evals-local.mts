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
    /** Write the run's report as JSON here, for ownerbench-parity. */
    "json-out": { type: "string" },
    /** Only write the report of this finished run (with --json-out). */
    report: { type: "string" },
    /** The held-out journeys' JSON file (kept outside the repository); --ownerbench then runs both sets. */
    holdout: { type: "string" },
  },
});

// Read where the eval cases are built, on the first import below.
if (values.holdout) process.env.OWNERBENCH_HOLDOUT_FILE = values.holdout;

async function writeReport(runId: string, path: string) {
  const { getEvalRunReport } = await import(
    "@/services/evals/eval-runs.service"
  );
  const { writeFile } = await import("node:fs/promises");
  await writeFile(
    path,
    JSON.stringify(await getEvalRunReport(runId), (_key, value) =>
      typeof value === "bigint" ? Number(value) : value,
    ),
  );
  console.log(`Report written to ${path}`);
}

if (values.report) {
  if (!values["json-out"]) throw new Error("--report needs --json-out");
  await writeReport(values.report, values["json-out"]);
  process.exit(0);
}

if (values.plan) process.env.SOKO_BOT_LOCAL_CHATGPT_PLAN = "1";
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
const progress = (output: unknown) => {
  const { score, totals } = (output ?? {}) as {
    score?: { stepsPassed: number; stepsTotal: number; reached: number };
    totals?: { toolErrors: number; retries: number; costUsd: number };
  };
  return score && totals
    ? `steps ${score.stepsPassed}/${score.stepsTotal}, first ${score.reached} in a row, ${totals.toolErrors} tool errors, ${totals.retries} retries, $${totals.costUsd.toFixed(2)}`
    : "";
};
for (const result of results)
  console.log(
    [
      result.caseId,
      `r${result.repeat}`,
      result.status,
      result.durationMs == null
        ? ""
        : `${Math.round(result.durationMs / 1000)}s`,
      progress(result.output),
      result.error?.slice(0, 160) ?? "",
    ].join("\t"),
  );
console.log(
  `\nDetails: sokosumi evals show ${run.id} --markdown --api-url <this Core>`,
);
if (values["json-out"]) await writeReport(run.id, values["json-out"]);
await prisma.$disconnect();
process.exit(0);
