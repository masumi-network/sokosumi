import { createNetworkScope } from "@/lib/db/network-scope";

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
 * there. Meant to run after the Preprod schema has been rebuilt; nothing calls
 * it yet. It takes no scope: it builds Preprod's from the one factory, so no
 * caller can hand it another Network's client. The factory refuses while
 * Preprod is off (on today's layout Preprod's table is Mainnet's), before any
 * statement. Safe to run again: only rows that are missing are inserted (the
 * conflict handling stays for a concurrent run), so an admin's later edit
 * survives. The caller must have verified that the configured schema names
 * map to the physical schemas they are meant for: the factory trusts them.
 */
export async function seedPreprodCreditCosts(): Promise<void> {
  const scope = createNetworkScope("preprod");
  await scope.netTransaction(async (tx) => {
    const existing = await tx.creditCost.findMany({
      where: { unit: { in: PREPROD_CREDIT_COSTS.map(({ unit }) => unit) } },
      select: { unit: true },
    });
    const have = new Set(existing.map(({ unit }) => unit));
    const missing = PREPROD_CREDIT_COSTS.filter(({ unit }) => !have.has(unit));
    if (missing.length === 0) return;
    await tx.creditCost.createMany({
      data: missing.map((cost) => ({ ...cost })),
      skipDuplicates: true,
    });
  }, "Preprod's rates changed while they were seeded");
}
