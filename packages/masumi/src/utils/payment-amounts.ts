/**
 * Masumi/Cardano uses both an empty string and "lovelace" for ADA. This is the
 * single spelling everything downstream (credit costs, pricing projection,
 * purchase reconciliation) compares on, so it lives with the protocol types
 * rather than being restated per consumer.
 */
export function normalizeMasumiPaymentUnit(unit: string): string {
  return unit === "" || unit.toLowerCase() === "lovelace" ? "lovelace" : unit;
}

export function aggregateMasumiPaymentAmounts(
  amounts: unknown,
): Map<string, bigint> | null {
  if (!Array.isArray(amounts)) {
    return null;
  }

  const totals = new Map<string, bigint>();
  for (const amount of amounts) {
    if (
      typeof amount !== "object" ||
      amount === null ||
      !("amount" in amount) ||
      !("unit" in amount) ||
      typeof amount.amount !== "string" ||
      typeof amount.unit !== "string" ||
      !/^\d+$/.test(amount.amount)
    ) {
      return null;
    }

    const unit = normalizeMasumiPaymentUnit(amount.unit);
    totals.set(unit, (totals.get(unit) ?? 0n) + BigInt(amount.amount));
  }

  return totals;
}

export function doMasumiPaymentAmountsMatch(
  expected: unknown,
  actual: unknown,
): boolean {
  const expectedAmounts = aggregateMasumiPaymentAmounts(expected);
  const actualAmounts = aggregateMasumiPaymentAmounts(actual);
  if (
    expectedAmounts === null ||
    actualAmounts === null ||
    expectedAmounts.size !== actualAmounts.size
  ) {
    return false;
  }

  return Array.from(expectedAmounts).every(
    ([unit, amount]) => actualAmounts.get(unit) === amount,
  );
}
