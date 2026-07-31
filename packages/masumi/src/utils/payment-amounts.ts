function normalizePaymentUnit(unit: string): string {
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

    const unit = normalizePaymentUnit(amount.unit);
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
