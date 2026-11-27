import type { SokoBotRoute, TurnClassification } from "@sokosumi/soko-bot";

/** Routes whose work requires taskboard / work context and skills. */
export const WORK_PRELOAD_ROUTES = new Set<SokoBotRoute>([
  "DELEGATE_TASK",
  "HIRE_AGENT",
  "MANAGE_WORK",
  "MIXED",
]);

/** Combined actionable-route probability bar for preloading work skills/board. */
export const MIN_WORK_PRELOAD_CONFIDENCE = 0.25;

/**
 * Resolves the work route used to preload skills and taskboard context under
 * E1 route steering when Jev fell back to `CLARIFY` or `DIRECT_RESPONSE` on a
 * split vote, abstention, or classifier outage. Returns `null` when there is
 * no meaningful work signal (such as pure Q&A or a refusal).
 */
export function effectiveWorkRouteForPreload(input: {
  route?: string | null;
  unsureRoute?: unknown;
  rawRoute?: unknown;
  workConfidence?: unknown;
  classifierFailed?: unknown;
}): SokoBotRoute | null {
  if (
    typeof input.route === "string" &&
    WORK_PRELOAD_ROUTES.has(input.route as SokoBotRoute)
  )
    return input.route as SokoBotRoute;
  if (
    typeof input.unsureRoute === "string" &&
    WORK_PRELOAD_ROUTES.has(input.unsureRoute as SokoBotRoute)
  )
    return input.unsureRoute as SokoBotRoute;
  if (
    typeof input.rawRoute === "string" &&
    WORK_PRELOAD_ROUTES.has(input.rawRoute as SokoBotRoute)
  )
    return input.rawRoute as SokoBotRoute;
  if (
    input.classifierFailed === true ||
    (typeof input.workConfidence === "number" &&
      input.workConfidence >= MIN_WORK_PRELOAD_CONFIDENCE)
  )
    return "MANAGE_WORK";
  return null;
}

/**
 * Returns the classification used to size the context packet (board rows,
 * coworkers, hireable agents) without mutating the stored diagnostic
 * `trigger.route`. Active only on `routeSteering` foreground human chat turns.
 */
export function classificationForPacketSizing(input: {
  classification: TurnClassification;
  personAsked?: boolean;
  routeSteering?: boolean;
}): TurnClassification {
  if (!input.routeSteering || !input.personAsked) return input.classification;
  const preloadRoute = effectiveWorkRouteForPreload(input.classification);
  if (!preloadRoute || preloadRoute === input.classification.route)
    return input.classification;
  return {
    ...input.classification,
    route: preloadRoute,
  };
}
