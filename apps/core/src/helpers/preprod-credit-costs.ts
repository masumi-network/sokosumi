import type { NetworkScope } from "@/lib/db/network-scope";
import { requireNetworkOn } from "@/lib/network";

/**
 * A scope the type checker knows is Preprod's. A Mainnet scope is a type
 * error here, and `seedPreprodCreditCosts` refuses it at run time too.
 */
export type PreprodScope = NetworkScope & { readonly network: "preprod" };

/**
 * Preprod's rates. `centsPerUnit` is cents per SMALLEST unit (`agent-cost.ts`
 * multiplies the amount in base units by it), 10^10 cents are one credit, and
 * both assets have 6 decimals: 1_000_000 gives 10^12 cents, 100 credits, for
 * 1 tUSDM and for 1 tADA alike. The tUSDM row is the old Preprod's only row.
 * The units are in the canonical spelling of `canonical_credit_cost_unit`:
 * ADA is `lovelace`, never `''`.
 */
export const PREPROD_CREDIT_COSTS = [
  {
    unit: "16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde0014df10745553444d",
    centsPerUnit: 1_000_000n,
  },
  { unit: "lovelace", centsPerUnit: 1_000_000n },
] as const;

/**
 * Writes `PREPROD_CREDIT_COSTS` into Preprod's `CreditCost` table, and only
 * there. Called by the wipe-and-rebuild of Preprod (ticket 41) after it has
 * redeployed the schema; nothing calls it yet. Safe to run again: a row that
 * exists is left as it is, so an admin's later edit survives.
 */
export async function seedPreprodCreditCosts(
  scope: PreprodScope,
): Promise<void> {
  // A refusing scope throws on this read by itself.
  const { network } = scope;
  if (network !== "preprod") {
    throw new Error(`Preprod's rates cannot be seeded on ${String(network)}`);
  }
  // On today's layout Preprod's table is Mainnet's: refuse while Preprod is off.
  requireNetworkOn(network);
  await scope.netTransaction(
    (tx) =>
      tx.creditCost.createMany({
        data: PREPROD_CREDIT_COSTS.map((cost) => ({ ...cost })),
        skipDuplicates: true,
      }),
    "Preprod's rates changed while they were seeded",
  );
}
