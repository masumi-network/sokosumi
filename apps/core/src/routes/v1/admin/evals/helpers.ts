import type { EvalResult, EvalRun } from "@sokosumi/database";
import { badRequest, notFound } from "@/helpers/error";
import { EvalRunError } from "@/services/evals/eval-runs.service";

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export function toEvalRunDto(run: EvalRun) {
  const models = asRecord(run.models);
  return {
    ...run,
    models: Object.fromEntries(
      Object.entries(models).map(([key, value]) => [
        key,
        typeof value === "string" ? value : null,
      ]),
    ),
  };
}

export function toEvalResultDto(result: EvalResult) {
  return {
    id: result.id,
    caseId: result.caseId,
    repeat: result.repeat,
    status: result.status,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    turnId: result.turnId,
    checks: Array.isArray(result.checks) ? result.checks : [],
    judge: result.judge ? asRecord(result.judge) : null,
    judgeModel: result.judgeModel,
    output: asRecord(result.output),
    error: result.error,
    costUsd:
      result.costUsdMicros === null ? null : Number(result.costUsdMicros) / 1e6,
    durationMs: result.durationMs,
  };
}

/** The service's refusals as HTTP: a missing run is 404, anything else 400. */
export function evalHttpError(error: unknown): never {
  if (error instanceof EvalRunError)
    throw /not found/i.test(error.message)
      ? notFound(error.message)
      : badRequest(error.message);
  throw error;
}
