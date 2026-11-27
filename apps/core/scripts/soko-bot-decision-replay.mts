/**
 * Export stored Jev decision receipts (`decision.receipt`) to JSONL or replay
 * scenarios against real Jev (`typesafe-ai/jev`) under baseline vs candidate
 * policies. Jev-only and cheap: never invokes non-Jev models.
 *
 * Examples:
 *   pnpm --filter @sokosumi/core soko-bot:decision-replay --markdown
 *   pnpm --filter @sokosumi/core soko-bot:decision-replay --kind route \
 *     --baseline route-baseline --candidate route-keel --markdown
 *   pnpm --filter @sokosumi/core soko-bot:decision-replay --export \
 *     --limit 50 --out /tmp/receipts.jsonl
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import type { DecisionKind } from "@sokosumi/soko-bot";
import prisma from "@/lib/db/prisma";
import { exportDecisionReceiptsFromDb } from "@/lib/soko-bot/decision-receipts";
import {
  type DecisionReplayPolicy,
  formatReplayComparisonMarkdown,
  parseReplayScenarios,
  REPLAY_POLICIES,
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
    kind: kindFilter === "all" ? undefined : kindFilter,
    sokoBotId: values["bot-id"],
    turnId: values["turn-id"],
    limit: Number(values.limit),
  });
  const jsonl = serializeReplayScenariosJsonl(exported);
  if (values.out) {
    writeFileSync(values.out, jsonl ? `${jsonl}\n` : "", "utf8");
    console.log(
      `Exported ${exported.length} decision receipt(s) to ${values.out}`,
    );
  } else {
    console.log(jsonl);
  }
  await prisma.$disconnect();
  process.exit(0);
}

// Replays use real Jev via AI_GATEWAY_API_KEY (never the ChatGPT plan stand-in).
process.env.SOKO_BOT_LOCAL_CHATGPT_PLAN = "0";

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

if (values["json-out"]) {
  writeFileSync(
    values["json-out"],
    JSON.stringify(
      { comparison, baselineReceipts, candidateReceipts },
      null,
      2,
    ),
    "utf8",
  );
}

if (values.markdown) {
  console.log(formatReplayComparisonMarkdown(comparison));
} else {
  const { baseline: b, candidate: c } = comparison;
  console.log(
    `Baseline  (${b.policyId}): wins ${b.selectorWins}/${b.total}, pass ${b.effectivePasses}/${b.total}, fb ${b.fallbacks}, stale ${b.staleCaught}, unsafe ${b.safetyViolations}, err ${b.errors}, p50 ${b.medianLatencyMs}ms, $${b.totalCostUsd.toFixed(6)}`,
  );
  console.log(
    `Candidate (${c.policyId}): wins ${c.selectorWins}/${c.total}, pass ${c.effectivePasses}/${c.total}, fb ${c.fallbacks}, stale ${c.staleCaught}, unsafe ${c.safetyViolations}, err ${c.errors}, p50 ${c.medianLatencyMs}ms, $${c.totalCostUsd.toFixed(6)}`,
  );
  console.log(
    `Verdict: ${comparison.verdict.toUpperCase()} — ${comparison.verdictReason}`,
  );
}
