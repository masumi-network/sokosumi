/**
 * Measures the route classifier on labelled owner messages and stores the
 * result for the admin console (Soko Bots → Model evaluations).
 *
 *   ROUTER_EVAL_RUNS=3 ROUTER_EVAL_COMPARE=google/gemini-3.8-flash \
 *     pnpm --filter @sokosumi/core soko-bot:router-eval
 *
 * Each case in `fixtures/soko-bot-router-cases.json` names the tools the turn
 * should end up with: READ (reads only), DELEGATE (Task work), HIRE, or
 * MANAGE:<scope> for one kind of change. Scoring the outcome rather than the
 * raw route is the point: it includes the thresholds that turn Jev's answer
 * into a tool grant. ROUTER_EVAL_COMPARE optionally adds an EU-pinned LLM
 * classifier given the same route descriptions, for comparison.
 */
import { readFileSync } from "node:fs";
import { SOKO_BOT_ROUTES } from "@sokosumi/soko-bot";
import { generateText, Output } from "ai";
import { z } from "zod";

import prisma from "@/lib/db/prisma";
import {
  JevTurnClassifier,
  routeQuestions,
  SOKO_BOT_ROUTE_MODEL,
} from "@/lib/soko-bot/classifier";
import {
  type RouterCall,
  type RouterCase,
  summarizeRouterRun,
} from "@/lib/soko-bot/model-evaluation";
import { sokoBotModelRequest } from "@/lib/soko-bot/model-policy";

const cases: RouterCase[] = z
  .array(
    z.object({
      message: z.string().min(1),
      previousReply: z.string().optional(),
      want: z.string().min(1),
      alt: z.array(z.string()).optional(),
    }),
  )
  .parse(
    JSON.parse(
      readFileSync(
        new URL("./fixtures/soko-bot-router-cases.json", import.meta.url),
        "utf8",
      ),
    ),
  );
const runs = Number(process.env.ROUTER_EVAL_RUNS ?? 3);
const compare = process.env.ROUTER_EVAL_COMPARE?.trim();

function outcome(route: string, scope?: string | null): string {
  if (route === "HIRE_AGENT") return "HIRE";
  if (route === "DELEGATE_TASK" || route === "MIXED") return "DELEGATE";
  if (route === "MANAGE_WORK") return scope ? `MANAGE:${scope}` : "READ";
  return "READ";
}

const jev = new JevTurnClassifier();
async function viaJev(item: RouterCase) {
  const result = await jev.classify(item.message, {
    previousReply: item.previousReply ?? null,
    projectIds: [],
    coworkerIds: [],
    agentIds: [],
    taskIds: [],
    jobIds: [],
  });
  if (result.failed) throw new Error("Jev unavailable");
  return {
    outcome: outcome(
      result.classification.route,
      result.classification.writeScope,
    ),
    costUsd: result.usage?.costUsd ?? 0,
  };
}

const questions = routeQuestions(false);
const scopes = Object.keys(questions.writeScope.criteria) as [
  string,
  ...string[],
];
const llmSchema = z.object({
  route: z.enum(SOKO_BOT_ROUTES as unknown as [string, ...string[]]),
  writeScope: z.enum(scopes).nullable(),
});
const llmInstructions = [
  questions.route.instructions,
  "",
  "Routes:",
  ...Object.entries(questions.route.criteria).map(([k, v]) => `- ${k}: ${v}`),
  "",
  `writeScope: ${questions.writeScope.instructions} Use null when the message asks for no change of the assistant's own.`,
  ...Object.entries(questions.writeScope.criteria).map(
    ([k, v]) => `- ${k}: ${v}`,
  ),
].join("\n");
async function viaLlm(model: string, item: RouterCase) {
  const result = await generateText({
    ...sokoBotModelRequest({ role: "judge", model }),
    instructions: llmInstructions,
    output: Output.object({ schema: llmSchema }),
    prompt: JSON.stringify({
      message: item.message,
      previousReply: item.previousReply ?? null,
      pendingProposals: [],
    }),
    abortSignal: AbortSignal.timeout(30_000),
  });
  const answer = llmSchema.parse(result.output);
  const cost = Number(
    (result.providerMetadata?.gateway as { cost?: unknown } | undefined)
      ?.cost ?? 0,
  );
  return { outcome: outcome(answer.route, answer.writeScope), costUsd: cost };
}

const classifiers: [
  string,
  (item: RouterCase) => Promise<{ outcome: string; costUsd: number }>,
][] = [
  [SOKO_BOT_ROUTE_MODEL, viaJev],
  ...(compare
    ? [
        [compare, (item: RouterCase) => viaLlm(compare, item)] as [
          string,
          typeof viaJev,
        ],
      ]
    : []),
];

const calls: RouterCall[] = [];
for (const [classifier, classify] of classifiers) {
  for (let run = 1; run <= runs; run++) {
    await Promise.all(
      cases.map(async (item, caseIndex) => {
        const started = Date.now();
        try {
          const answer = await classify(item);
          calls.push({
            classifier,
            caseIndex,
            ...answer,
            ms: Date.now() - started,
          });
        } catch {
          calls.push({
            classifier,
            caseIndex,
            outcome: null,
            costUsd: 0,
            ms: Date.now() - started,
          });
        }
      }),
    );
    console.log(`${classifier}: run ${run} of ${runs}`);
  }
}

const summary = summarizeRouterRun(calls, cases);
const stored = await prisma.sokoBotModelEvaluation.create({
  data: {
    kind: "ROUTER",
    label: `Routing · ${cases.length} labelled messages × ${runs} runs`,
    inUseModel: SOKO_BOT_ROUTE_MODEL,
    models: summary.models,
    cases: summary.cases,
  },
  select: { id: true },
});
for (const row of summary.models)
  console.log(
    `${row.classifier}: ${row.correct}/${row.calls} correct, ${row.overGrants} over-grants, ${row.underGrants} under-grants, median ${row.medianMs} ms`,
  );
console.log(`Stored evaluation ${stored.id}.`);
await prisma.$disconnect();
