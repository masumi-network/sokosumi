/**
 * Real-Jev routing accuracy on labelled owner messages, through the production
 * classifier (questions, thresholds and fallbacks included). Nothing is stored
 * in a database.
 *
 *   pnpm --filter @sokosumi/core jev:routing-bench -- --runs 3 \
 *     --holdout /path/outside/repo/jev-routing-heldout.json --report out.md
 *
 * The dev set (`fixtures/jev-routing-set.json`) is for tuning. The held-out
 * set lives outside the repository and is reported as totals only: nobody
 * tunes on it. A live run caches every case × run next to each set
 * (`*.answers.json`): the exact input Jev saw, every attempt including
 * failures, and the outcome. `--rescore` replays that cache through the
 * current classifier without calling Jev, so threshold and fallback changes
 * cost nothing to measure. It refuses a cache made with other questions, one
 * that does not cover the set exactly, and one whose inputs no longer match.
 *
 * Calls real Jev with the .env Gateway key (fractions of a cent per run).
 * `--max-usd` is a hard cap: every attempt, retries included, reserves
 * `--usd-per-attempt` before it is sent, and the run stops before the first
 * attempt that could pass the cap.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isDeepStrictEqual, parseArgs } from "node:util";
import { planJevMode } from "@/lib/plan-jev";
import {
  evaluateWithJev,
  JevTurnClassifier,
  routeQuestions,
} from "@/lib/soko-bot/classifier";
import { gatewayCostUsd } from "@/lib/soko-bot/gateway-cost";
import {
  type AnswerCache,
  type CachedAttempt,
  type CachedCall,
  checkReplayCoverage,
  outcomeOf,
  parseRoutingCases,
  type RoutingCall,
  type RoutingCase,
  routingMisses,
  routingReport,
  SpendGate,
  summarizeRouting,
} from "@/lib/soko-bot/routing-bench";

const { values } = parseArgs({
  options: {
    set: {
      type: "string",
      default: new URL("./fixtures/jev-routing-set.json", import.meta.url)
        .pathname,
    },
    holdout: { type: "string" },
    runs: { type: "string", default: "1" },
    rescore: { type: "boolean", default: false },
    report: { type: "string" },
    "max-usd": { type: "string", default: "1" },
    "usd-per-attempt": { type: "string", default: "0.002" },
    concurrency: { type: "string", default: "6" },
  },
});

function number(name: string, raw: string, integer: boolean, min: number) {
  const value = Number(raw);
  if (
    !Number.isFinite(value) ||
    value < min ||
    (integer && !Number.isInteger(value))
  )
    throw new Error(
      `--${name} must be ${integer ? "a whole number" : "a number"} of at least ${min}, not "${raw}".`,
    );
  return value;
}
const runs = number("runs", values.runs, true, 1);
const concurrency = number("concurrency", values.concurrency, true, 1);
const maxUsd = number("max-usd", values["max-usd"], false, 0);
const perAttemptUsd = number(
  "usd-per-attempt",
  values["usd-per-attempt"],
  false,
  Number.MIN_VALUE,
);

if (planJevMode() === "stand-in")
  throw new Error(
    "This is a plan run with the Jev stand-in; the bench measures real Jev.",
  );

const QUESTIONS_HASH = createHash("sha256")
  .update(JSON.stringify([routeQuestions(false), routeQuestions(true)]))
  .digest("hex")
  .slice(0, 12);
const gate = new SpendGate(maxUsd, perAttemptUsd);
/** Set by a stop that must end the whole run, not fail one case. */
let fatal: Error | null = null;

const cachePath = (setPath: string) =>
  `${setPath.replace(/\.json$/, "")}.answers.json`;

async function classify(
  item: RoutingCase,
  run: number,
  replay: CachedCall | undefined,
): Promise<{ call: RoutingCall; cached: CachedCall }> {
  const attempts: CachedAttempt[] = [];
  let costUsd = 0;
  const classifier = new JevTurnClassifier(async (request) => {
    if (replay) {
      const attempt = replay.attempts[attempts.length];
      if (!attempt || !isDeepStrictEqual(attempt.state, request.state)) {
        fatal ??= new Error(
          `The cached input for ${item.id} run ${run} differs from what the classifier sends now: run live.`,
        );
        throw fatal;
      }
      attempts.push(attempt);
      if (attempt.evaluation) return attempt.evaluation;
      throw new Error(attempt.error ?? "Cached failure");
    }
    if (fatal) throw fatal;
    if (!gate.admit()) {
      fatal ??= new Error(
        `Stopped before sending: the next attempt could pass the $${maxUsd} cap (spent $${gate.spentUsd.toFixed(4)}).`,
      );
      throw fatal;
    }
    try {
      const evaluation = await evaluateWithJev(request);
      const cost = gatewayCostUsd(evaluation.providerMetadata);
      gate.settle(cost);
      costUsd += cost;
      attempts.push({ state: request.state, evaluation });
      return evaluation;
    } catch (error) {
      gate.settle(null);
      attempts.push({
        state: request.state,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  });
  const result = await classifier.classify(item.message, {
    previousReply: item.previousReply ?? null,
    projectIds: [],
    coworkerIds: [],
    agentIds: [],
    taskIds: [],
    jobIds: [],
  });
  const got = result.failed ? null : outcomeOf(result.classification);
  const answers = attempts.findLast((attempt) => attempt.evaluation)?.evaluation
    ?.answers as
    | { route?: { choice?: string; probabilities?: Record<string, number> } }
    | undefined;
  const jevRoute = answers?.route?.choice ?? null;
  return {
    call: {
      caseId: item.id,
      run,
      got,
      jevRoute,
      jevConfidence: jevRoute
        ? (answers?.route?.probabilities?.[jevRoute] ?? null)
        : null,
      unsureRoute: result.classification.unsureRoute ?? null,
      complexity: result.classification.complexity?.label ?? null,
      costUsd,
    },
    cached: { caseId: item.id, run, attempts, got },
  };
}

async function pool<T>(jobs: (() => Promise<T>)[]): Promise<T[]> {
  const results: T[] = new Array(jobs.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
      while (next < jobs.length && !fatal) {
        const index = next++;
        results[index] = await (jobs[index] as () => Promise<T>)();
      }
    }),
  );
  if (fatal) throw fatal;
  return results;
}

async function bench(setPath: string) {
  const cases = parseRoutingCases(JSON.parse(readFileSync(setPath, "utf8")));
  const cacheFile = cachePath(setPath);
  let cache: AnswerCache | null = null;
  if (values.rescore) {
    if (!existsSync(cacheFile))
      throw new Error(`No cached answers at ${cacheFile}`);
    cache = JSON.parse(readFileSync(cacheFile, "utf8")) as AnswerCache;
    checkReplayCoverage(cases, cache, QUESTIONS_HASH);
  }
  const byId = new Map(cases.map((item) => [item.id, item]));
  const jobs = cache
    ? cache.calls.map(
        (replay) => () =>
          classify(byId.get(replay.caseId) as RoutingCase, replay.run, replay),
      )
    : Array.from({ length: runs }, (_, run) =>
        cases.map((item) => () => classify(item, run + 1, undefined)),
      ).flat();
  const results = await pool(jobs);
  if (!cache)
    writeFileSync(
      cacheFile,
      JSON.stringify({
        questionsHash: QUESTIONS_HASH,
        runs,
        createdAt: new Date().toISOString(),
        calls: results.map((result) => result.cached),
      } satisfies AnswerCache),
    );
  return { cases, calls: results.map((result) => result.call) };
}

const mode = values.rescore ? "replayed answers" : "live, real Jev";
const sections: string[] = [
  `# Jev routing bench (${mode}, questions ${QUESTIONS_HASH})`,
];
const dev = await bench(values.set);
sections.push(
  routingReport(
    `Dev set: ${dev.cases.length} cases`,
    summarizeRouting(dev.cases, dev.calls),
  ),
  "### Dev misses",
  routingMisses(dev.cases, dev.calls),
);
if (values.holdout) {
  const held = await bench(values.holdout);
  sections.push(
    routingReport(
      `Held-out set: ${held.cases.length} cases (totals only)`,
      summarizeRouting(held.cases, held.calls),
    ),
  );
}
sections.push(`Spent on Jev this run: $${gate.spentUsd.toFixed(4)}.`);
const text = sections.join("\n\n");
if (values.report) writeFileSync(values.report, `${text}\n`);
console.log(text);
