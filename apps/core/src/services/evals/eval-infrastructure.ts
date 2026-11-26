import { z } from "zod";
import { AI_BUDGET_EXCEEDED } from "@/lib/ai-gateway-budget";
import {
  aiGatewayBudgetScope,
  GATEWAY_INTERNAL_SERVER_ERROR,
} from "@/lib/ai-gateway-budget-error";
import prisma from "@/lib/db/prisma";
import { localChatGptPlanEnabled } from "@/lib/local-chatgpt-plan";
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
    | "chat_delivery_failed"
    | "case_unsettled"
    | "context_organizer_failed";
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

/** The organizer's Jev log in a stored packet; undefined when no organizer ran. */
function organizerJev(
  packet: unknown,
): { failed?: unknown } | null | undefined {
  const organizer = (
    packet as {
      workspace?: { marketing?: { organizer?: { jev?: unknown } } | null };
    } | null
  )?.workspace?.marketing?.organizer;
  if (!organizer || typeof organizer !== "object") return undefined;
  const jev = organizer.jev;
  return jev && typeof jev === "object" ? jev : null;
}

/** Turns whose context organizer lost its Jev read ran on fallback context. */
export function organizerFailure(
  packets: readonly unknown[],
): EvalInfrastructureFailure | null {
  const jevs = packets.map(organizerJev).filter((jev) => jev !== undefined);
  const failed = jevs.filter((jev) => jev?.failed).length;
  if (failed === 0) return null;
  return {
    code: "context_organizer_failed",
    stopsRun: false,
    message: "The context organizer's plan stand-in was unavailable",
    detail: `${failed} of ${jevs.length} organized turn(s) lost the context pick and ran on fallback context, so the case measures that, not the bot`,
  };
}

/**
 * On a plan run, a case whose turns (or their background runs) lost the
 * organizer's read is an infrastructure ERROR. On the gateway it stays scored:
 * there a timeout is the product's own.
 */
export async function organizerCaseOutcome(
  turnIds: readonly string[],
  output: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CaseOutcome | null> {
  if (!localChatGptPlanEnabled(env)) return null;
  const seen = new Set(turnIds);
  let frontier = [...turnIds];
  while (frontier.length) {
    const children = await prisma.sokoBotTurn.findMany({
      where: { parentTurnId: { in: frontier }, id: { notIn: [...seen] } },
      select: { id: true },
    });
    frontier = children.map((child) => child.id);
    for (const id of frontier) seen.add(id);
  }
  const snapshots = await prisma.sokoBotContextSnapshot.findMany({
    where: { turnId: { in: [...seen] } },
    select: { packet: true },
  });
  const failure = organizerFailure(snapshots.map(({ packet }) => packet));
  return failure
    ? {
        status: "ERROR",
        checks: [],
        output: { ...output, infrastructure: failure, notExecuted: false },
        error: `${failure.message}: ${failure.detail}`,
        turnIds: [...turnIds],
      }
    : null;
}

/**
 * Asks the judge only when no turn of the case is excluded: the judge stores
 * its grade on the turn, and an excluded turn must not carry one.
 */
export async function judgeUnlessExcluded<T>(
  turnIds: readonly string[],
  output: Record<string, unknown>,
  judge: () => Promise<T>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ excluded: CaseOutcome } | { judged: T }> {
  const excluded = await organizerCaseOutcome(turnIds, output, env);
  return excluded ? { excluded } : { judged: await judge() };
}

/**
 * Every scored case passes here before it is stored, so all of its turns are
 * checked: follow-ups, finish turns, chain and month turns alike.
 */
export async function guardOrganizer(
  outcome: CaseOutcome,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CaseOutcome> {
  if (outcome.status !== "PASSED" && outcome.status !== "FAILED")
    return outcome;
  return (
    (await organizerCaseOutcome(outcome.turnIds, outcome.output, env)) ??
    outcome
  );
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
