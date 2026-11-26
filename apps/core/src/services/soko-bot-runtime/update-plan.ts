import {
  type SokoBotPlanLoopUpdatePlanInput,
  sokoBotPlanLoopUpdatePlanInputSchema,
} from "@sokosumi/soko-bot";
import {
  type ChainPlan,
  type PlanStep,
  readChainPlan,
  resolveRequestChain,
} from "@/lib/soko-bot/request-chain";
import { resolveSokoBotVersion } from "@/services/soko-bot-version.service";
import {
  type AuthorizedSokoBotRuntime,
  SokoBotRuntimeValidationError,
} from "../soko-bot-runtime.service";

type InputStep = SokoBotPlanLoopUpdatePlanInput["steps"][number];

const sameText = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

function settled(step: InputStep): PlanStep {
  if (step.status === "blocked" && (!step.blockedOn || !step.reason))
    throw new SokoBotRuntimeValidationError(
      `Step "${step.step}" is blocked: say who it waits on (blockedOn) and why (reason).`,
    );
  if (step.status === "skipped" && !step.reason)
    throw new SokoBotRuntimeValidationError(
      `Step "${step.step}" is skipped: say why (reason).`,
    );
  return {
    id: step.id ?? "",
    step: step.step,
    status: step.status,
    ...(step.status === "blocked" ? { blockedOn: step.blockedOn } : {}),
    ...(step.status === "blocked" || step.status === "skipped"
      ? { reason: step.reason }
      : {}),
  };
}

/**
 * The new plan with stable step ids: a step keeps the id it was given, or
 * the id of the earlier step with the same text; a new step gets the next
 * free one.
 */
function withIds(steps: PlanStep[], previous: ChainPlan | null): PlanStep[] {
  const known = previous?.steps ?? [];
  const used = new Set(
    [...known, ...steps].map((step) => step.id).filter(Boolean),
  );
  let next = known.length + 1;
  const freshId = () => {
    while (used.has(`s${next}`)) next++;
    used.add(`s${next}`);
    return `s${next}`;
  };
  const ided = steps.map((step) => ({
    ...step,
    id:
      step.id ||
      known.find((earlier) => sameText(earlier.step, step.step))?.id ||
      freshId(),
  }));
  const seen = new Set<string>();
  for (const step of ided) {
    if (seen.has(step.id))
      throw new SokoBotRuntimeValidationError(
        `Two steps share the id "${step.id}": give each step its own.`,
      );
    seen.add(step.id);
  }
  return ided;
}

/**
 * update_plan on a planLoop version: the plan is kept for the whole owner
 * request. Every step of the current plan stays in the next one; a step
 * that is no longer wanted is skipped with a reason, never dropped.
 */
export async function updatePlan(
  authorized: AuthorizedSokoBotRuntime,
  input: unknown,
): Promise<ChainPlan> {
  const version = await resolveSokoBotVersion(authorized.turn.versionId);
  if (!version.planLoop)
    throw new SokoBotRuntimeValidationError(
      "update_plan runs in your sandbox on this version.",
    );
  const parsed = sokoBotPlanLoopUpdatePlanInputSchema.parse(input);
  const chain = await resolveRequestChain(authorized.turn.id);
  const previous = await readChainPlan(chain);
  const steps = withIds(parsed.steps.map(settled), previous);
  const dropped = (previous?.steps ?? []).filter(
    (earlier) => !steps.some((step) => step.id === earlier.id),
  );
  if (dropped.length)
    throw new SokoBotRuntimeValidationError(
      `The plan must keep every step it had. Missing: ${dropped
        .map((step) => `${step.id} "${step.step}"`)
        .join(
          ", ",
        )}. Keep them (by id), and mark one skipped with a reason if it is no longer needed.`,
    );
  return {
    requestId: chain[0] as string,
    revision: (previous?.revision ?? 0) + 1,
    steps,
  };
}
