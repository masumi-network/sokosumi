import { SOKO_BOT_PLAN_STEP_STATUSES } from "@sokosumi/soko-bot";
import { z } from "zod";
import prisma from "@/lib/db/prisma";

const MAX_CHAIN_TURNS = 8;

/**
 * The turns of one owner request, oldest first, ending with `turnId`: a
 * background run or watch wake belongs to the turn that started it, a
 * Coworker or Agent follow-up wake to the turn that handed the work over. A
 * new chat turn is a request of its own. A wake that carries follow-ups from
 * several requests belongs to none of them.
 */
export async function resolveRequestChain(turnId: string): Promise<string[]> {
  const chain = [turnId];
  while (chain.length < MAX_CHAIN_TURNS) {
    const origin = await originTurnId(chain[0] as string);
    if (!origin || chain.includes(origin)) break;
    chain.unshift(origin);
  }
  return chain;
}

async function originTurnId(turnId: string): Promise<string | null> {
  const turn = await prisma.sokoBotTurn.findUnique({
    where: { id: turnId },
    select: { parentTurnId: true },
  });
  if (turn?.parentTurnId) return turn.parentTurnId;
  const delegations = await prisma.sokoBotDelegation.findMany({
    where: { followUpTurnId: turnId },
    select: { turnId: true },
    distinct: ["turnId"],
    take: 2,
  });
  if (delegations.length === 1) return delegations[0]?.turnId ?? null;
  if (delegations.length > 1) return null;
  const watch = await prisma.sokoBotWatch.findFirst({
    where: { firedTurnId: turnId },
    select: { turnId: true },
  });
  return watch?.turnId ?? null;
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

/**
 * The request's current plan: the latest update_plan Core accepted in the
 * chain. A sandbox's own turn-local plan (older versions) is not one.
 */
export async function readChainPlan(
  chain: readonly string[],
): Promise<ChainPlan | null> {
  const rows = await prisma.sokoBotToolCall.findMany({
    where: {
      turnId: { in: [...chain] },
      capability: "update_plan",
      status: "COMPLETED",
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { result: true },
    take: 10,
  });
  for (const row of rows) {
    const plan = chainPlanSchema.safeParse(row.result);
    if (plan.success) return plan.data;
  }
  return null;
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
  const plan = await readChainPlan(await resolveRequestChain(turnId));
  return plan ? `${text}\n\n${planRecital(plan)}` : text;
}
