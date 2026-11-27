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
 * tunes on it. Every live call's raw Jev answers are cached next to each set
 * (`*.answers.json`), and `--rescore` replays them through the current
 * classifier without calling Jev: threshold and fallback changes cost nothing
 * to measure. A change to the questions needs a live run; `--rescore` refuses
 * a cache made with other questions.
 *
 * Calls real Jev with the .env Gateway key (fractions of a cent per run);
 * `--max-usd` stops the run past its cap.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { planJevMode } from "@/lib/plan-jev";
import {
  evaluateWithJev,
  JevTurnClassifier,
  type RouteEvaluation,
  routeQuestions,
} from "@/lib/soko-bot/classifier";
import {
  outcomeOf,
  parseRoutingCases,
  type RoutingCall,
  type RoutingCase,
  routingMisses,
  routingReport,
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
    concurrency: { type: "string", default: "6" },
  },
});

if (planJevMode() === "stand-in")
  throw new Error(
    "This is a plan run with the Jev stand-in; the bench measures real Jev.",
  );

const QUESTIONS_HASH = createHash("sha256")
  .update(JSON.stringify([routeQuestions(false), routeQuestions(true)]))
  .digest("hex")
  .slice(0, 12);
const runs = Number(values.runs);
const maxUsd = Number(values["max-usd"]);
const concurrency = Number(values.concurrency);
let spentUsd = 0;

interface CachedCall extends RouteEvaluation {
  caseId: string;
  run: number;
}
interface Cache {
  questionsHash: string;
  createdAt: string;
  calls: CachedCall[];
}

const cachePath = (setPath: string) =>
  setPath.replace(/\.json$/, "") + ".answers.json";

async function classify(
  item: RoutingCase,
  run: number,
  replay: CachedCall | undefined,
  record: CachedCall[],
): Promise<RoutingCall> {
  const classifier = new JevTurnClassifier(async (request) => {
    if (replay) return replay;
    if (spentUsd > maxUsd) throw new Error(`Stopped: past the $${maxUsd} cap`);
    const evaluation = await evaluateWithJev(request);
    record.push({ caseId: item.id, run, ...evaluation });
    return evaluation;
  });
  const result = await classifier.classify(item.message, {
    previousReply: item.previousReply ?? null,
    projectIds: [],
    coworkerIds: [],
    agentIds: [],
    taskIds: [],
    jobIds: [],
  });
  const costUsd = replay ? 0 : (result.usage?.costUsd ?? 0);
  spentUsd += costUsd;
  const answers = (
    replay ?? record.findLast((c) => c.caseId === item.id && c.run === run)
  )?.answers as
    | { route?: { choice?: string; probabilities?: Record<string, number> } }
    | undefined;
  const jevRoute = answers?.route?.choice ?? null;
  return {
    caseId: item.id,
    run,
    got: result.failed ? null : outcomeOf(result.classification),
    jevRoute,
    jevConfidence: jevRoute
      ? (answers?.route?.probabilities?.[jevRoute] ?? null)
      : null,
    unsureRoute: result.classification.unsureRoute ?? null,
    complexity: result.classification.complexity?.label ?? null,
    costUsd,
  };
}

async function pool<T>(jobs: (() => Promise<T>)[]): Promise<T[]> {
  const results: T[] = new Array(jobs.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
      while (next < jobs.length) {
        const index = next++;
        results[index] = await (jobs[index] as () => Promise<T>)();
      }
    }),
  );
  return results;
}

async function bench(setPath: string) {
  const cases = parseRoutingCases(JSON.parse(readFileSync(setPath, "utf8")));
  const cacheFile = cachePath(setPath);
  let cache: Cache | null = null;
  if (values.rescore) {
    if (!existsSync(cacheFile))
      throw new Error(`No cached answers at ${cacheFile}`);
    cache = JSON.parse(readFileSync(cacheFile, "utf8")) as Cache;
    if (cache.questionsHash !== QUESTIONS_HASH)
      throw new Error(
        `${cacheFile} was made with other Jev questions (${cache.questionsHash}, now ${QUESTIONS_HASH}): run live.`,
      );
  }
  const record: CachedCall[] = [];
  const jobs = (
    cache
      ? cache.calls.map((replay) => {
          const item = cases.find((c) => c.id === replay.caseId);
          return item ? () => classify(item, replay.run, replay, record) : null;
        })
      : Array.from({ length: runs }, (_, run) =>
          cases.map((item) => () => classify(item, run + 1, undefined, record)),
        ).flat()
  ).filter((job) => job !== null);
  const calls = await pool(jobs);
  if (!cache)
    writeFileSync(
      cacheFile,
      JSON.stringify({
        questionsHash: QUESTIONS_HASH,
        createdAt: new Date().toISOString(),
        calls: record,
      } satisfies Cache),
    );
  return { cases, calls };
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
sections.push(`Spent on Jev this run: $${spentUsd.toFixed(4)}.`);
const text = sections.join("\n\n");
if (values.report) writeFileSync(values.report, `${text}\n`);
console.log(text);
