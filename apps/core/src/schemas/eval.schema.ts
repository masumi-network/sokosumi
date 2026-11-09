import { z } from "@hono/zod-openapi";
import { dateTimeSchema } from "@/helpers/datetime";

export const evalSuiteSchema = z.enum(["soko-bot", "cmo"]).openapi("EvalSuite");

export const evalOutcomeSchema = z
  .enum([
    "regressed",
    "fixed",
    "flaky",
    "failing",
    "passing",
    "error",
    "pending",
    "skipped",
  ])
  .openapi("EvalOutcome");

export const evalResultStatusSchema = z
  .enum(["PENDING", "RUNNING", "PASSED", "FAILED", "ERROR", "SKIPPED"])
  .openapi("EvalResultStatus");

export const evalRunSchema = z
  .object({
    id: z.string(),
    createdAt: dateTimeSchema,
    startedAt: dateTimeSchema.nullable(),
    finishedAt: dateTimeSchema.nullable(),
    trigger: z.enum(["DAILY", "MANUAL"]),
    status: z.enum(["QUEUED", "RUNNING", "COMPLETED", "CANCELLED"]),
    suites: z.array(z.string()),
    caseIds: z.array(z.string()),
    repeats: z.number().int(),
    commitSha: z.string().nullable(),
    commitMessage: z.string().nullable(),
    prNumber: z.number().int().nullable(),
    environment: z.string(),
    label: z.string().nullable(),
    startedByUserId: z.string().nullable(),
    /** Versions and models the lanes ran on. */
    models: z.record(z.string(), z.string().nullable()),
  })
  .openapi("EvalRun");

const suiteScoreSchema = z.object({
  passed: z.number().int(),
  scored: z.number().int(),
  failed: z.number().int(),
  errors: z.number().int(),
  skipped: z.number().int(),
  open: z.number().int(),
  passRate: z.number().nullable(),
});

export const evalRunListItemSchema = evalRunSchema
  .extend({
    scores: z.record(z.string(), suiteScoreSchema),
    costUsd: z.number(),
  })
  .openapi("EvalRunListItem");

export const evalCheckSchema = z
  .object({ label: z.string(), pass: z.boolean(), actual: z.string() })
  .openapi("EvalCheck");

export const evalResultSchema = z
  .object({
    id: z.string(),
    caseId: z.string(),
    repeat: z.number().int(),
    status: evalResultStatusSchema,
    startedAt: dateTimeSchema.nullable(),
    finishedAt: dateTimeSchema.nullable(),
    turnId: z.string().nullable(),
    checks: z.array(evalCheckSchema),
    /** The judge's verdict: verdict, scores, rationale, issues. */
    judge: z.record(z.string(), z.unknown()).nullable(),
    judgeModel: z.string().nullable(),
    /** What the case produced: answer, tools, plan. */
    output: z.record(z.string(), z.unknown()),
    error: z.string().nullable(),
    costUsd: z.number().nullable(),
    durationMs: z.number().int().nullable(),
  })
  .openapi("EvalResult");

const evalRunRefSchema = z.object({
  id: z.string(),
  createdAt: dateTimeSchema,
  prNumber: z.number().int().nullable(),
  commitSha: z.string().nullable(),
});

export const evalCaseReportSchema = z
  .object({
    caseId: z.string(),
    suite: z.string(),
    area: z.string(),
    title: z.string(),
    intent: z.string(),
    outcome: evalOutcomeSchema,
    states: z.array(evalResultStatusSchema),
    passRate: z.number().nullable(),
    baselinePassRate: z.number().nullable(),
    /** Pass rate in earlier daily runs, newest first; null where it did not run. */
    history: z.array(z.number().nullable()),
    results: z.array(evalResultSchema),
  })
  .openapi("EvalCaseReport");

export const evalRunReportSchema = z
  .object({
    run: evalRunSchema,
    /** The daily run on main this run is compared with. */
    baseline: z.union([evalRunRefSchema, z.null()]),
    /** Earlier daily runs, newest first, the order of each case's history. */
    history: z.array(evalRunRefSchema),
    summary: z.object({
      counts: z.record(evalOutcomeSchema, z.number().int()),
      passed: z.number().int(),
      scored: z.number().int(),
      open: z.number().int(),
      costUsd: z.number(),
    }),
    cases: z.array(evalCaseReportSchema),
  })
  .openapi("EvalRunReport");

export const evalCaseBaselineSchema = z
  .object({
    run: z.union([evalRunRefSchema, z.null()]),
    results: z.array(evalResultSchema),
  })
  .openapi("EvalCaseBaseline");

export const evalCaseDefinitionSchema = z
  .object({
    id: z.string(),
    suite: evalSuiteSchema,
    area: z.string(),
    title: z.string(),
    intent: z.string(),
    kind: z.string(),
    requires: z.string().nullable(),
  })
  .openapi("EvalCaseDefinition");

export const createEvalRunBodySchema = z
  .object({
    suites: z.array(evalSuiteSchema).min(1).optional(),
    caseIds: z.array(z.string().min(1)).max(200).optional(),
    repeats: z.number().int().min(1).max(3).optional(),
    label: z.string().trim().min(1).max(120).optional(),
    /** Try a version before promoting it; the default version otherwise. */
    sokoBotVersionId: z.string().min(1).max(41).optional(),
    cusoVersionId: z.string().min(1).max(41).optional(),
    /** A local Core only: the commit the CLI runs from. */
    commitSha: z
      .string()
      .regex(/^[0-9a-f]{7,40}$/)
      .optional(),
    commitMessage: z.string().max(300).optional(),
  })
  .strict()
  .openapi("CreateEvalRunBody");

export const evalTickSchema = z
  .object({
    runId: z.string().nullable(),
    completed: z.boolean(),
    /** Another tick was already moving the run. */
    busy: z.boolean(),
  })
  .openapi("EvalTick");
