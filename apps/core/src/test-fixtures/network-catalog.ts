import { randomUUID } from "node:crypto";

import type { NetworkScope } from "@/lib/db/network-scope";
import { onSplitLayout } from "@/test/split-layout";

/**
 * A free Cardano V1 Agent the catalog lists, and a credit cost, in the
 * scope's Network. `id` gives the Agent a chosen id, so two Networks can hold
 * the same one. Returns what removes them.
 */
export async function seedCatalogAgent(
  scope: NetworkScope,
  agent: { name: string; id?: string },
) {
  const unit = `n20_${randomUUID()}`;
  const created = await scope.netTransaction(async (tx) => {
    // shortcut: the unit trigger calls `public.canonical_credit_cost_unit`,
    // which the split layout moved to `shared`; drop this line with ticket 19.
    if (onSplitLayout) {
      await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
    }
    const cost = await tx.creditCost.create({
      data: { unit, centsPerUnit: 1n },
    });
    const row = await tx.agent.create({
      data: {
        ...(agent.id && { id: agent.id }),
        blockchainIdentifier: randomUUID(),
        name: agent.name,
        description: "Fixture",
        apiBaseUrl: "https://agent.example.com",
        isShown: true,
        lastUptimeCheck: new Date(),
        uptimeCount: 1,
        uptimeCheckCount: 1,
        pricing: { create: { pricingType: "FREE" } },
      },
    });
    return { costId: cost.id, agentId: row.id, pricingId: row.pricingId };
  }, "Fixture conflict");
  return {
    agentId: created.agentId,
    remove: () =>
      scope.netTransaction(async (tx) => {
        await tx.agent.delete({ where: { id: created.agentId } });
        await tx.agentPricing.delete({ where: { id: created.pricingId } });
        await tx.creditCost.delete({ where: { id: created.costId } });
      }, "Fixture conflict"),
  };
}
