import { z } from "zod";
import { AI_BUDGET_EXCEEDED } from "@/lib/ai-gateway-budget";
import {
  aiGatewayBudgetScope,
  GATEWAY_INTERNAL_SERVER_ERROR,
} from "@/lib/ai-gateway-budget-error";
import prisma from "@/lib/db/prisma";
import type { CaseOutcome } from "./eval-case-runner";

const MAX_INFRASTRUCTURE_DETAIL_CHARS = 2_000;
const BUDGET_EXHAUSTED_CODE = "provider_budget_exhausted";
const failureSchema = z.object({
  status: z.literal("FAILED"),
  errorKind: z.enum([
    GATEWAY_INTERNAL_SERVER_ERROR,
    AI_BUDGET_EXCEEDED,
    "runner_exited",
  ]),
  errorDetail: z.string().nullable().optional(),
});

export interface EvalInfrastructureFailure {
  code:
    | "provider_budget_exhausted"
    | "provider_failure"
    | "runner_exited"
    | "chat_delivery_failed";
  stopsRun: boolean;
  message: string;
  detail: string;
}

/** Only known execution failures qualify; behavioral failures remain scored. */
export function evalInfrastructureFailure(
  value: unknown,
): EvalInfrastructureFailure | null {
  const parsed = failureSchema.safeParse(value);
  if (!parsed.success) return null;
  const detail = (parsed.data.errorDetail ?? "").slice(
    0,
    MAX_INFRASTRUCTURE_DETAIL_CHARS,
  );
  if (parsed.data.errorKind === "runner_exited")
    return {
      code: "runner_exited" as const,
      stopsRun: false,
      message: "The evaluation runner exited before completing the turn",
      detail,
    };
  const exhausted =
    parsed.data.errorKind === AI_BUDGET_EXCEEDED ||
    Boolean(aiGatewayBudgetScope(detail));
  return {
    code: exhausted ? BUDGET_EXHAUSTED_CODE : "provider_failure",
    stopsRun: exhausted,
    message: exhausted
      ? "AI Gateway budget exhausted"
      : "AI Gateway could not complete the evaluation turn",
    detail,
  };
}

export function infrastructureCaseOutcome(
  turnId: string,
  turn: unknown,
  output: Record<string, unknown>,
): CaseOutcome | null {
  const failure = evalInfrastructureFailure(turn);
  return failure
    ? {
        status: "ERROR",
        checks: [],
        output: { ...output, infrastructure: failure, notExecuted: false },
        error: failure.message,
        turnIds: [turnId],
      }
    : null;
}

/** A hard cap stops each lane before its next start. Other lanes may be starting. */
export async function stopPendingAfterBudgetError(
  runId: string,
  repeat: number,
) {
  const blocked = await prisma.evalResult.findFirst({
    where: {
      runId,
      status: "ERROR",
      AND: [
        {
          output: {
            path: ["infrastructure", "code"],
            equals: BUDGET_EXHAUSTED_CODE,
          },
        },
        { output: { path: ["notExecuted"], equals: false } },
      ],
    },
    select: { id: true, output: true },
  });
  if (!blocked) return false;
  const failure = z
    .object({
      infrastructure: z.object({
        code: z.literal(BUDGET_EXHAUSTED_CODE),
        stopsRun: z.literal(true),
      }),
    })
    .safeParse(blocked.output);
  if (!failure.success) return false;
  await prisma.evalResult.updateMany({
    where: { runId, repeat, status: "PENDING" },
    data: {
      status: "ERROR",
      finishedAt: new Date(),
      error: `Not executed: AI Gateway budget exhausted (result ${blocked.id})`,
      checks: [],
      output: {
        infrastructure: failure.data.infrastructure,
        notExecuted: true,
        blockedByResultId: blocked.id,
      },
    },
  });
  return true;
}
