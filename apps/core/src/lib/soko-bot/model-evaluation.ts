import { z } from "@hono/zod-openapi";

/**
 * Scoring for the admin console's model evaluations: candidate models for a
 * Soko Bot role, run on the same hand-graded cases. Pure, so what the console
 * shows is exactly what the tests check. The scripts that make the calls
 * live in `apps/core/scripts/soko-bot-{judge,router}-eval.mts`.
 */

const verdictSchema = z.enum(["pass", "weak", "fail"]);
export type JudgeVerdictLabel = z.infer<typeof verdictSchema>;

export interface JudgeCall {
  model: string;
  caseId: string;
  verdict: JudgeVerdictLabel | null;
  costUsd: number;
  ms: number;
}

export interface JudgeCase {
  caseId: string;
  /** What reading the turn supports; "uncertain" cases are shown, not scored. */
  grade: JudgeVerdictLabel | "uncertain";
  why?: string;
  /** Lab turns as they ran, or turns picked because they went wrong. */
  set: "lab" | "known-bad";
}

export const judgeModelSummarySchema = z.object({
  model: z.string(),
  calls: z.number().int(),
  errors: z.number().int(),
  /** Cases where every run gave the same verdict, of cases run twice or more. */
  steady: z.number().int(),
  repeated: z.number().int(),
  /** Majority verdict equals the hand grade, over graded cases. */
  matches: z.number().int(),
  graded: z.number().int(),
  /** "fail" verdicts on turns graded pass: the costly kind of wrong. */
  falseFails: z.number().int(),
  /** Known-bad turns the majority verdict did not pass. */
  badCaught: z.number().int(),
  bad: z.number().int(),
  costPerCallUsd: z.number(),
  medianMs: z.number(),
});
export type JudgeModelSummary = z.infer<typeof judgeModelSummarySchema>;

export const judgeCaseSummarySchema = z.object({
  caseId: z.string(),
  grade: z.enum(["pass", "weak", "fail", "uncertain"]),
  why: z.string().nullable(),
  set: z.enum(["lab", "known-bad"]),
  /** Every verdict per model, in run order; null where the call errored. */
  answers: z.record(z.string(), z.array(verdictSchema.nullable())),
  /** Some model's majority differs from the grade. */
  contested: z.boolean(),
});
export type JudgeCaseSummary = z.infer<typeof judgeCaseSummarySchema>;

function majority<T>(values: readonly T[]): T | undefined {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return (
    sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0
  );
}

export function summarizeJudgeRun(
  calls: readonly JudgeCall[],
  cases: readonly JudgeCase[],
): { models: JudgeModelSummary[]; cases: JudgeCaseSummary[] } {
  const models = [...new Set(calls.map((call) => call.model))];
  const answersOf = (model: string, caseId: string) =>
    calls
      .filter((call) => call.model === model && call.caseId === caseId)
      .map((call) => call.verdict);

  const summaries = models.map((model) => {
    const own = calls.filter((call) => call.model === model);
    let steady = 0;
    let repeated = 0;
    let matches = 0;
    let graded = 0;
    let falseFails = 0;
    let badCaught = 0;
    let bad = 0;
    for (const item of cases) {
      const verdicts = answersOf(model, item.caseId).filter(
        (verdict): verdict is JudgeVerdictLabel => verdict !== null,
      );
      if (verdicts.length === 0) continue;
      if (verdicts.length > 1) {
        repeated += 1;
        if (new Set(verdicts).size === 1) steady += 1;
      }
      if (item.grade === "uncertain") continue;
      const verdict = majority(verdicts);
      graded += 1;
      if (verdict === item.grade) matches += 1;
      if (item.grade === "pass")
        falseFails += verdicts.filter((v) => v === "fail").length;
      if (item.set === "known-bad") {
        bad += 1;
        if (verdict !== "pass") badCaught += 1;
      }
    }
    const answered = own.filter((call) => call.verdict !== null);
    return {
      model,
      calls: own.length,
      errors: own.length - answered.length,
      steady,
      repeated,
      matches,
      graded,
      falseFails,
      badCaught,
      bad,
      costPerCallUsd:
        own.reduce((total, call) => total + call.costUsd, 0) /
        Math.max(own.length, 1),
      medianMs: median(answered.map((call) => call.ms)),
    };
  });

  const caseSummaries = cases.map((item) => {
    const answers = Object.fromEntries(
      models.map((model) => [model, answersOf(model, item.caseId)]),
    );
    const contested =
      item.grade !== "uncertain" &&
      models.some((model) => {
        const verdicts = answers[model]?.filter((v) => v !== null) ?? [];
        return verdicts.length > 0 && majority(verdicts) !== item.grade;
      });
    return {
      caseId: item.caseId,
      grade: item.grade,
      why: item.why ?? null,
      set: item.set,
      answers,
      contested,
    };
  });

  return { models: summaries, cases: caseSummaries };
}

/** What a route decision grants: reads only, Task work, a hire, or one kind of change. */
export type RouterOutcome = string;

export interface RouterCall {
  classifier: string;
  caseIndex: number;
  outcome: RouterOutcome | null;
  costUsd: number;
  ms: number;
}

export interface RouterCase {
  message: string;
  previousReply?: string;
  want: RouterOutcome;
  /** Other outcomes that are also right, e.g. a Task edit as work either way. */
  alt?: string[];
}

export const routerModelSummarySchema = z.object({
  classifier: z.string(),
  calls: z.number().int(),
  errors: z.number().int(),
  correct: z.number().int(),
  /** Cases right on every run. */
  alwaysRight: z.number().int(),
  /** Cases run more than once that gave the same answer every time. */
  steady: z.number().int(),
  cases: z.number().int(),
  /** Granted writes to a message that asked for none: the unsafe direction. */
  overGrants: z.number().int(),
  /** Left a request for a change with reads only. */
  underGrants: z.number().int(),
  medianMs: z.number(),
  p90Ms: z.number(),
  costPer1kUsd: z.number(),
});
export type RouterModelSummary = z.infer<typeof routerModelSummarySchema>;

export const routerCaseSummarySchema = z.object({
  message: z.string(),
  previousReply: z.string().nullable(),
  want: z.string(),
  answers: z.record(z.string(), z.array(z.string().nullable())),
  /** Some classifier got it wrong on some run. */
  contested: z.boolean(),
});
export type RouterCaseSummary = z.infer<typeof routerCaseSummarySchema>;

const READ_ONLY = "READ";

export function summarizeRouterRun(
  calls: readonly RouterCall[],
  cases: readonly RouterCase[],
): { models: RouterModelSummary[]; cases: RouterCaseSummary[] } {
  const classifiers = [...new Set(calls.map((call) => call.classifier))];
  const right = (item: RouterCase, outcome: string | null) =>
    outcome !== null &&
    (outcome === item.want || (item.alt ?? []).includes(outcome));
  const answersOf = (classifier: string, index: number) =>
    calls
      .filter(
        (call) => call.classifier === classifier && call.caseIndex === index,
      )
      .map((call) => call.outcome);

  const models = classifiers.map((classifier) => {
    const own = calls.filter((call) => call.classifier === classifier);
    const answered = own.filter((call) => call.outcome !== null);
    let alwaysRight = 0;
    let steady = 0;
    cases.forEach((item, index) => {
      const outcomes = answersOf(classifier, index);
      if (outcomes.length === 0) return;
      if (outcomes.every((outcome) => right(item, outcome))) alwaysRight += 1;
      // Only a case run more than once can show it is stable, and an error
      // is no answer at all.
      if (
        outcomes.length > 1 &&
        !outcomes.includes(null) &&
        new Set(outcomes).size === 1
      )
        steady += 1;
    });
    const want = (call: RouterCall) => cases[call.caseIndex]?.want;
    return {
      classifier,
      calls: own.length,
      errors: own.length - answered.length,
      correct: own.filter((call) => {
        const item = cases[call.caseIndex];
        return item ? right(item, call.outcome) : false;
      }).length,
      alwaysRight,
      steady,
      cases: cases.length,
      overGrants: answered.filter(
        (call) => want(call) === READ_ONLY && call.outcome !== READ_ONLY,
      ).length,
      underGrants: answered.filter(
        (call) => want(call) !== READ_ONLY && call.outcome === READ_ONLY,
      ).length,
      medianMs: median(answered.map((call) => call.ms)),
      p90Ms: percentile(
        answered.map((call) => call.ms),
        0.9,
      ),
      costPer1kUsd:
        (own.reduce((total, call) => total + call.costUsd, 0) /
          Math.max(own.length, 1)) *
        1_000,
    };
  });

  const caseSummaries = cases.map((item, index) => {
    const answers = Object.fromEntries(
      classifiers.map((classifier) => [
        classifier,
        answersOf(classifier, index),
      ]),
    );
    return {
      message: item.message,
      previousReply: item.previousReply ?? null,
      want: item.want,
      answers,
      contested: Object.values(answers).some((outcomes) =>
        outcomes.some((outcome) => !right(item, outcome)),
      ),
    };
  });

  return { models, cases: caseSummaries };
}
