/**
 * Masumi/Cardano uses both an empty string and "lovelace" for ADA. This is the
 * single spelling everything downstream (credit costs, pricing projection,
 * purchase reconciliation) compares on, so it lives with the protocol types
 * rather than being restated per consumer.
 */
function isAsciiWhitespace(code: number): boolean {
  // tab, lf, vt, ff, cr, space
  return (
    code === 0x09 ||
    code === 0x0a ||
    code === 0x0b ||
    code === 0x0c ||
    code === 0x0d ||
    code === 0x20
  );
}

function trimAsciiWhitespace(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && isAsciiWhitespace(value.charCodeAt(start))) {
    start += 1;
  }
  while (end > start && isAsciiWhitespace(value.charCodeAt(end - 1))) {
    end -= 1;
  }
  return value.slice(start, end);
}

export function normalizeMasumiPaymentUnit(unit: string): string {
  // Protocol transport whitespace only (ASCII). Linear scan — a
  // /^[\t\n\v\f\r ]+|...+$/ trim is polynomial ReDoS on unit strings.
  const trimmedUnit = trimAsciiWhitespace(unit);
  if (trimmedUnit === "" || trimmedUnit.toLowerCase() === "lovelace") {
    return "lovelace";
  }
  // Cardano policy-id + asset-name units are hex; casing is not meaningful.
  return trimmedUnit.toLowerCase();
}

/**
 * Inverse of {@link normalizeMasumiPaymentUnit} for values leaving Sokosumi
 * toward the payment node.
 *
 * The registry serves ADA both ways — production preprod data holds 1527
 * `lovelace` rows and 180 empty-string rows in `UnitValue` — so ingestion
 * normalizes everything to `lovelace` to get one comparison scale. The payment
 * node's contract is the opposite: every `unit` field in payment.openapi.json
 * documents "Asset policy id + asset name concatenated. Empty string for
 * ADA/lovelace", including the `Amounts` of `POST /purchase`.
 *
 * Apply this at the boundary only. Internally `lovelace` stays canonical, and
 * `doMasumiPaymentAmountsMatch` normalizes both sides, so a node response that
 * spells ADA as "" still reconciles against a stored `lovelace` amount.
 */
function toMasumiPaymentNodeUnit(unit: string): string {
  return normalizeMasumiPaymentUnit(unit) === "lovelace" ? "" : unit;
}

export function toMasumiPaymentNodeAmounts(
  amounts: readonly { unit: string; amount: string }[],
): { unit: string; amount: string }[] {
  return amounts.map((entry) => ({
    unit: toMasumiPaymentNodeUnit(entry.unit),
    amount: entry.amount,
  }));
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
