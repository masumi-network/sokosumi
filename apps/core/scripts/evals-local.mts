/**
 * Run eval cases in this process against the database in `.env`, no Core
 * server or CLI login needed. With `--plan`, OpenAI models run on your own
 * ChatGPT plan (sign in first: `pnpm chatgpt-plan:login`); Gemini, Claude and
 * Jev calls stay on the Gateway. See docs/agents/evals.md.
 *
 *   pnpm --filter @sokosumi/core evals:local --plan --cases ambiguous-request
 *   pnpm --filter @sokosumi/core evals:local --plan --suite cmo --cuso-version cmo-v23
 */
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    plan: { type: "boolean", default: false },
    suite: { type: "string", multiple: true },
    cases: { type: "string" },
    repeats: { type: "string", default: "1" },
    "soko-bot-version": { type: "string" },
    "cuso-version": { type: "string" },
  },
});

if (values.plan) process.env.SOKO_BOT_LOCAL_CHATGPT_PLAN = "1";
process.env.SOKO_BOT_RUNTIME_ADAPTER = "in-process";

const { default: prisma } = await import("@/lib/db/prisma");
const { createEvalRun, tickEvalRuns } = await import(
  "@/services/evals/eval-runs.service"
);
if (values.plan) {
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
  suites: values.suite as ("soko-bot" | "cmo")[] | undefined,
  caseIds: values.cases?.split(",").map((id) => id.trim()),
  repeats: Number(values.repeats),
  sokoBotVersionId: values["soko-bot-version"] ?? null,
  cusoVersionId: values["cuso-version"] ?? null,
  label: values.plan ? "local, OpenAI on ChatGPT plan" : "local, Gateway",
  commit: {
    sha: git("rev-parse", "HEAD"),
    message: git("log", "-1", "--format=%s"),
  },
});
console.log(`Run ${run.id} (${values.plan ? "ChatGPT plan" : "Gateway"})`);

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
  },
});
for (const result of results)
  console.log(
    [
      result.caseId,
      `r${result.repeat}`,
      result.status,
      result.durationMs == null
        ? ""
        : `${Math.round(result.durationMs / 1000)}s`,
      result.error?.slice(0, 160) ?? "",
    ].join("\t"),
  );
console.log(
  `\nDetails: sokosumi evals show ${run.id} --markdown --api-url <this Core>`,
);
await prisma.$disconnect();
process.exit(0);
