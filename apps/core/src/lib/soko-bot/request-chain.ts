import type { Prisma } from "@sokosumi/database";
import { SOKO_BOT_PLAN_STEP_STATUSES } from "@sokosumi/soko-bot";
import { z } from "zod";
import prisma from "@/lib/db/prisma";

const MAX_CHAIN_TURNS = 8;
/** An operator's retry of one failed turn (soko-bot-notice-room.ts). */
const ADMIN_RETRY_KEY = /^admin-retry:([^:]+):/;

/**
 * The turn that started the owner request `turnId` belongs to; the plan is
 * kept under its id. A background run or watch wake belongs to the turn that
 * started it, a Coworker or Agent follow-up wake (its retry too) to the turn
 * that handed the work over, an operator's retry to the turn it retries. A
 * new chat turn is a request of its own, and so is a wake that carries
 * follow-ups from different requests.
 */
export async function resolveRequestId(turnId: string): Promise<string> {
  return rootOf(turnId, 0);
}

async function rootOf(turnId: string, depth: number): Promise<string> {
  if (depth >= MAX_CHAIN_TURNS) return turnId;
  const origins = await originTurnIds(turnId);
  if (!origins.length) return turnId;
  const roots = new Set(
    await Promise.all(origins.map((origin) => rootOf(origin, depth + 1))),
  );
  return roots.size === 1 ? ([...roots][0] as string) : turnId;
}

async function originTurnIds(turnId: string): Promise<string[]> {
  const turn = await prisma.sokoBotTurn.findUnique({
    where: { id: turnId },
    select: { parentTurnId: true, source: true, clientTurnId: true },
  });
  if (!turn) return [];
  if (turn.parentTurnId) return [turn.parentTurnId];
  const retried =
    turn.source === "ADMIN_RETRY"
      ? ADMIN_RETRY_KEY.exec(turn.clientTurnId ?? "")?.[1]
      : undefined;
  if (retried) return [retried];
  const delegations = await prisma.sokoBotDelegation.findMany({
    where: { followUpTurnId: turnId },
    select: { turnId: true },
    distinct: ["turnId"],
    take: 10,
  });
  if (delegations.length) return delegations.map(({ turnId }) => turnId);
  const watch = await prisma.sokoBotWatch.findFirst({
    where: { firedTurnId: turnId },
    select: { turnId: true },
  });
  return watch ? [watch.turnId] : [];
}

export const planStepSchema = z.object({
  id: z.string(),
  step: z.string(),
  status: z.enum(SOKO_BOT_PLAN_STEP_STATUSES),
  blockedOn: z.string().optional(),
  reason: z.string().optional(),
});
export type PlanStep = z.infer<typeof planStepSchema>;

/** What Core's update_plan stores as its result. */
export const chainPlanSchema = z.object({
  requestId: z.string(),
  revision: z.number().int().positive(),
  steps: z.array(planStepSchema),
});
export type ChainPlan = z.infer<typeof chainPlanSchema>;

/** Accepted plans of one request that a newer one might not yet follow. */
const READ_PLANS = 20;

/**
 * The request's current plan: the highest revision Core accepted for it, in
 * any turn of the request. A sandbox's own turn-local plan (older versions)
 * is not one.
 */
export async function readRequestPlan(
  sokoBotId: string,
  requestId: string,
  db: Prisma.TransactionClient = prisma,
): Promise<ChainPlan | null> {
  const rows = await db.sokoBotToolCall.findMany({
    where: {
      turn: { sokoBotId },
      capability: "update_plan",
      // Written under the request's lock before the call settles.
      status: { not: "FAILED" },
      result: { path: ["requestId"], equals: requestId },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { result: true },
    take: READ_PLANS,
  });
  let latest: ChainPlan | null = null;
  for (const row of rows) {
    const plan = chainPlanSchema.safeParse(row.result);
    if (plan.success && plan.data.revision > (latest?.revision ?? 0))
      latest = plan.data;
  }
  return latest;
}

function stepLine(step: PlanStep): string {
  const state =
    step.status === "blocked"
      ? `blocked on ${step.blockedOn}: ${step.reason}`
      : step.status === "skipped"
        ? `skipped: ${step.reason}`
        : step.status;
  return `- ${step.id} [${state}] ${step.step}`;
}

/** The plan as a turn later in the request is shown it. */
export function planRecital(plan: ChainPlan): string {
  return `[Your plan for this request, kept from earlier in it (revision ${plan.revision}). Carry on from it and keep it current with update_plan:\n${plan.steps.map(stepLine).join("\n")}]`;
}

/** The turn's message with its request's plan, when an earlier turn made one. */
export async function withChainPlan(
  turnId: string,
  text: string,
): Promise<string> {
  const turn = await prisma.sokoBotTurn.findUnique({
    where: { id: turnId },
    select: { sokoBotId: true },
  });
  if (!turn) return text;
  const plan = await readRequestPlan(
    turn.sokoBotId,
    await resolveRequestId(turnId),
  );
  return plan ? `${text}\n\n${planRecital(plan)}` : text;
}
