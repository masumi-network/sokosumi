/**
 * Export stored Jev decision receipts (`decision.receipt`) from approved dev
 * eval runs to JSONL, or replay scenarios against real Jev (`typesafe-ai/jev`)
 * inside the ChatGPT plan's real-Jev accounting and pause breaker.
 *
 * Examples:
 *   pnpm --filter @sokosumi/core soko-bot:decision-replay --markdown
 *   pnpm --filter @sokosumi/core soko-bot:decision-replay --kind route \
 *     --baseline route-baseline --candidate route-keel --markdown
 *   pnpm --filter @sokosumi/core soko-bot:decision-replay --export \
 *     --eval-run-id <RUN_ID> --limit 50 --out /tmp/receipts.jsonl
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import type { DecisionKind } from "@sokosumi/soko-bot";
import prisma from "@/lib/db/prisma";
import { planJevMode, planJevStats } from "@/lib/plan-jev";
import { exportDecisionReceiptsFromDb } from "@/lib/soko-bot/decision-receipts";
import {
  type DecisionReplayPolicy,
  formatReplayComparisonMarkdown,
  parseReplayScenarios,
  REPLAY_POLICIES,
  RealJevUnavailableError,
  runDecisionReplayComparison,
  serializeReplayScenariosJsonl,
} from "@/lib/soko-bot/decision-replay";

const DEFAULT_SCENARIOS = new URL(
  "./fixtures/soko-bot-decision-replay-scenarios.jsonl",
  import.meta.url,
);

const DEFAULT_PAIRS: Record<DecisionKind, [string, string]> = {
  route: ["route-baseline", "route-keel"],
  focus: ["focus-baseline", "focus-keel"],
  completion: ["completion-baseline", "completion-keel"],
};

const { values } = parseArgs({
  options: {
    export: { type: "boolean", default: false },
    "eval-run-id": { type: "string" },
    scenarios: { type: "string" },
    kind: { type: "string", default: "all" },
    baseline: { type: "string" },
    candidate: { type: "string" },
    concurrency: { type: "string", default: "4" },
    limit: { type: "string", default: "100" },
    "bot-id": { type: "string" },
    "turn-id": { type: "string" },
    out: { type: "string" },
    "json-out": { type: "string" },
    markdown: { type: "boolean", default: false },
  },
});

function resolveKindFilter(raw: string): DecisionKind | "all" {
  if (
    raw === "all" ||
    raw === "route" ||
    raw === "focus" ||
    raw === "completion"
  )
    return raw;
  throw new Error(
    `Invalid --kind "${raw}". Expected all, route, focus, or completion.`,
  );
}

function requirePolicy(id: string): DecisionReplayPolicy {
  const policy = REPLAY_POLICIES[id];
  if (!policy) {
    throw new Error(
      `Unknown policy "${id}". Available: ${Object.keys(REPLAY_POLICIES).join(", ")}`,
    );
  }
  return policy;
}

const kindFilter = resolveKindFilter(values.kind);

if (values.export) {
  const exported = await exportDecisionReceiptsFromDb({
    evalRunId: values["eval-run-id"],
    kind: kindFilter === "all" ? undefined : kindFilter,
    sokoBotId: values["bot-id"],
    turnId: values["turn-id"],
    limit: Number(values.limit),
  });
  const jsonl = serializeReplayScenariosJsonl(exported);
  if (values.out) {
    writeFileSync(values.out, jsonl ? `${jsonl}\n` : "", "utf8");
    console.log(
      `Exported ${exported.length} decision receipt(s) from approved dev eval runs to ${values.out}`,
    );
  } else {
    console.log(jsonl);
  }
  await prisma.$disconnect();
  process.exit(0);
}

// Keep every real-Jev replay call inside the plan Jev ledger and pause breaker.
process.env.SOKO_BOT_LOCAL_CHATGPT_PLAN = "1";
process.env.SOKO_BOT_PLAN_REAL_JEV ??= "1";
const mode = planJevMode();
if (mode !== "real") {
  throw new RealJevUnavailableError(mode);
}

const rawScenarios = values.scenarios
  ? readFileSync(values.scenarios, "utf8")
  : readFileSync(DEFAULT_SCENARIOS, "utf8");
const allScenarios = parseReplayScenarios(rawScenarios);
const scenarios =
  kindFilter === "all"
    ? allScenarios
    : allScenarios.filter((scenario) => scenario.kind === kindFilter);

if (!scenarios.length) {
  throw new Error(`No replay scenarios matched kind="${kindFilter}".`);
}

let baselinePolicies: DecisionReplayPolicy[];
let candidatePolicies: DecisionReplayPolicy[];
if (values.baseline || values.candidate) {
  if (!values.baseline || !values.candidate) {
    throw new Error("Pass both --baseline and --candidate together.");
  }
  baselinePolicies = values.baseline
    .split(",")
    .map((id) => requirePolicy(id.trim()));
  candidatePolicies = values.candidate
    .split(",")
    .map((id) => requirePolicy(id.trim()));
} else {
  const kinds: DecisionKind[] =
    kindFilter === "all" ? ["route", "focus", "completion"] : [kindFilter];
  baselinePolicies = kinds.map((k) => requirePolicy(DEFAULT_PAIRS[k][0]));
  candidatePolicies = kinds.map((k) => requirePolicy(DEFAULT_PAIRS[k][1]));
}

const { comparison, baselineReceipts, candidateReceipts } =
  await runDecisionReplayComparison({
    scenarios,
    baselinePolicies,
    candidatePolicies,
    concurrency: Number(values.concurrency),
  });
const jevLedger = planJevStats();

if (values["json-out"]) {
  writeFileSync(
    values["json-out"],
    JSON.stringify(
      { comparison, baselineReceipts, candidateReceipts, jevLedger },
      null,
      2,
    ),
    "utf8",
  );
}

if (values.markdown) {
  console.log(formatReplayComparisonMarkdown(comparison));
  console.log(
    `\n_Plan Jev ledger: ${jevLedger.calls} calls, ${jevLedger.failures} failed, $${jevLedger.costUsd.toFixed(6)}, ${jevLedger.standInWindows.length} pause window(s)._`,
  );
} else {
  const { baseline: b, candidate: c } = comparison;
  console.log(
    `Baseline  (${b.policyId}): wins ${b.selectorWins}/${b.scored}, pass ${b.effectivePasses}/${b.scored} (${b.unlabelled} unlabelled), fb ${b.fallbacks}, stale ${b.staleCaught}, unsafe ${b.safetyViolations}, err ${b.errors}, p50 ${b.medianLatencyMs}ms, $${b.totalCostUsd.toFixed(6)}`,
  );
  console.log(
    `Candidate (${c.policyId}): wins ${c.selectorWins}/${c.scored}, pass ${c.effectivePasses}/${c.scored} (${c.unlabelled} unlabelled), fb ${c.fallbacks}, stale ${c.staleCaught}, unsafe ${c.safetyViolations}, err ${c.errors}, p50 ${c.medianLatencyMs}ms, $${c.totalCostUsd.toFixed(6)}`,
  );
  console.log(
    `Verdict: ${comparison.verdict.toUpperCase()} — ${comparison.verdictReason}`,
  );
  console.log(
    `Plan Jev ledger: ${jevLedger.calls} calls, ${jevLedger.failures} failed, $${jevLedger.costUsd.toFixed(6)}, ${jevLedger.standInWindows.length} pause window(s)`,
  );
}
