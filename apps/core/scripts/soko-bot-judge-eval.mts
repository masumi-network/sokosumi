/**
 * Compares candidate lab judges on hand-graded lab turns and stores the
 * result for the admin console (Soko Bots → Model evaluations).
 *
 *   JUDGE_EVAL_GRADES=grades.json JUDGE_EVAL_MODELS=a,b JUDGE_EVAL_RUNS=2 \
 *     pnpm --filter @sokosumi/core soko-bot:judge-eval
 *
 * GRADES is a JSON array of { caseId, turnId, scenario, grade, why?, set }:
 * `grade` is what reading the turn supports ("pass" | "weak" | "fail" |
 * "uncertain"), and `set` is "lab" for turns as they ran or "known-bad" for
 * turns picked because they went wrong. Grade before looking at any model's
 * verdict, or the comparison measures agreement with the model you read.
 *
 * Every candidate is asked for an EU-only route, so the Gateway refuses rather
 * than falls back outside the EU; an answer whose reported region is not the
 * EU is still discarded, in case that ever changes. Only lab turns are judged.
 */
import { readFileSync } from "node:fs";
import {
  SOKO_BOT_JUDGE_RUBRIC,
  sokoBotJudgeVerdictSchema,
} from "@sokosumi/soko-bot";
import { gateway, generateText, Output } from "ai";
import { z } from "zod";

import prisma from "@/lib/db/prisma";
import {
  type JudgeCall,
  summarizeJudgeRun,
} from "@/lib/soko-bot/model-evaluation";
import {
  loadLabJudgePayload,
  sokoBotJudgeModel,
} from "@/services/soko-bot-lab-judge.service";

const gradesSchema = z.array(
  z.object({
    caseId: z.string().min(1),
    turnId: z.string().min(1),
    scenario: z.string().min(1),
    grade: z.enum(["pass", "weak", "fail", "uncertain"]),
    why: z.string().optional(),
    set: z.enum(["lab", "known-bad"]),
  }),
);

const grades = gradesSchema.parse(
  JSON.parse(readFileSync(process.env.JUDGE_EVAL_GRADES ?? "", "utf8")),
);
const models = (process.env.JUDGE_EVAL_MODELS ?? "")
  .split(",")
  .map((model) => model.trim())
  .filter(Boolean);
const runs = Number(process.env.JUDGE_EVAL_RUNS ?? 2);
if (grades.length === 0 || models.length === 0 || !(runs >= 1)) {
  console.error(
    "Set JUDGE_EVAL_GRADES (a graded case file), JUDGE_EVAL_MODELS and JUDGE_EVAL_RUNS.",
  );
  process.exit(1);
}

const TIMEOUT_MS = 180_000;
const CONCURRENCY = 6;
const EU_PROVIDERS = ["vertex", "bedrock"];

const payloads = new Map<string, unknown>();
for (const grade of grades)
  payloads.set(
    grade.caseId,
    await loadLabJudgePayload(grade.turnId, grade.scenario),
  );

const routingSchema = z.object({
  gateway: z.object({
    cost: z.coerce.number().optional(),
    routing: z.object({
      modelAttempts: z.array(
        z.object({
          providerAttempts: z.array(
            z.object({
              inferenceEndpoint: z.object({ geoRegion: z.string() }).nullish(),
            }),
          ),
        }),
      ),
    }),
  }),
});

async function judge(model: string, caseId: string): Promise<JudgeCall> {
  const started = Date.now();
  try {
    const result = await generateText({
      model: gateway.languageModel(model),
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(TIMEOUT_MS),
      providerOptions: {
        gateway: {
          inferenceRegion: { scope: "zone", geoRegion: "eu" },
          only: EU_PROVIDERS,
        },
      },
      output: Output.object({ schema: sokoBotJudgeVerdictSchema }),
      instructions: SOKO_BOT_JUDGE_RUBRIC,
      prompt: JSON.stringify(payloads.get(caseId)),
    });
    const metadata = routingSchema.parse(result.providerMetadata);
    const regions = metadata.gateway.routing.modelAttempts
      .flatMap((attempt) => attempt.providerAttempts)
      .flatMap((attempt) =>
        attempt.inferenceEndpoint ? [attempt.inferenceEndpoint.geoRegion] : [],
      );
    const inEu =
      regions.length > 0 && regions.every((region) => region === "eu");
    return {
      model,
      caseId,
      // Outside the EU the answer does not count, whatever it says.
      verdict: inEu
        ? sokoBotJudgeVerdictSchema.parse(result.output).verdict
        : null,
      costUsd: metadata.gateway.cost ?? 0,
      ms: Date.now() - started,
    };
  } catch (error) {
    console.warn(`${model} on ${caseId}: ${String(error).slice(0, 160)}`);
    return {
      model,
      caseId,
      verdict: null,
      costUsd: 0,
      ms: Date.now() - started,
    };
  }
}

const jobs = models.flatMap((model) =>
  Array.from({ length: runs }, () =>
    grades.map((grade) => () => judge(model, grade.caseId)),
  ).flat(),
);
const calls: JudgeCall[] = [];
let next = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      if (job) calls.push(await job());
    }
  }),
);

const summary = summarizeJudgeRun(calls, grades);
const stored = await prisma.sokoBotModelEvaluation.create({
  data: {
    kind: "JUDGE",
    label: `Judge comparison · ${grades.length} graded turns × ${runs} runs`,
    inUseModel: sokoBotJudgeModel(),
    models: summary.models,
    cases: summary.cases,
  },
  select: { id: true },
});
for (const row of summary.models)
  console.log(
    `${row.model}: ${row.matches}/${row.graded} match the grades, steady ${row.steady}/${row.repeated}, ${row.falseFails} false fails, $${row.costPerCallUsd.toFixed(3)}/call`,
  );
console.log(`Stored evaluation ${stored.id}.`);
await prisma.$disconnect();
