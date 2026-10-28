import type { MarketingStrategy } from "@sokosumi/database";

import { internalServerError } from "@/helpers/error";
import { parseMarketingPlan } from "@/services/marketing-strategy.service";

export function mapMarketingStrategy({
  turnId: _turnId,
  plan,
  ...version
}: MarketingStrategy) {
  const parsed = parseMarketingPlan(plan);
  // The version exists; a stored plan that no longer parses is Core's fault.
  if (!parsed) {
    throw internalServerError("Marketing strategy version has no valid plan");
  }
  return { ...version, plan: parsed };
}
