import { tableInsertRowSchema } from "@sokosumi/utils";
import { expect, it } from "vitest";
import { isNumericCsvColumn, tableImportBatches } from "./table-import";

it("bounds serialized UTF-8, JSON escaping and row count with deterministic keys", () => {
  const values = {
    "00000000-0000-4000-8000-000000000001": '💡"\\'.repeat(3000),
  };
  const rows = Array.from({ length: 120 }, () =>
    tableInsertRowSchema.parse({ values }),
  );
  const batches = tableImportBatches("import", rows);
  expect(batches).toEqual(tableImportBatches("import", rows));
  expect(batches.flatMap((batch) => batch.insert)).toEqual(rows);
  expect(batches.length).toBeGreaterThan(2);
  for (const batch of batches) {
    expect(batch.insert.length).toBeLessThanOrEqual(100);
    expect(
      new TextEncoder().encode(JSON.stringify(batch)).byteLength,
    ).toBeLessThanOrEqual(990_000);
  }
});
it("rejects an individually oversized request before creation", () => {
  expect(() =>
    tableImportBatches("import", [
      tableInsertRowSchema.parse({
        values: Object.fromEntries(
          Array.from({ length: 60 }, (_, i) => [
            `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
            "x".repeat(20000),
          ]),
        ),
      }),
    ]),
  ).toThrow("1 MB");
});
it("guesses Number only when every filled cell converts without loss", () => {
  expect(isNumericCsvColumn("revenue", ["1200", "1500.5", "-3", "0.25"])).toBe(
    true,
  );
  // Blanks are ignored, but an all-blank column stays Text.
  expect(isNumericCsvColumn("score", ["", " 7 ", "8"])).toBe(true);
  expect(isNumericCsvColumn("score", ["", " "])).toBe(false);
  // Mixed values, grouping, exponent, hex, plus sign and words stay Text.
  for (const value of ["12a", "1,200", "1e3", "0x1f", "+5", "NaN", "Infinity"])
    expect(isNumericCsvColumn("amount", ["1", value])).toBe(false);
  // Leading zeros and digits past a float's exact range are codes.
  expect(isNumericCsvColumn("amount", ["1", "007"])).toBe(false);
  expect(isNumericCsvColumn("amount", ["1234567890123456"])).toBe(false);
  expect(isNumericCsvColumn("amount", ["123456789012345"])).toBe(true);
  // Nonzero decimals that underflow to zero or go subnormal stay Text.
  const tiny = `0.${"0".repeat(323)}1`;
  expect(Number(tiny)).toBe(0);
  expect(isNumericCsvColumn("amount", [tiny])).toBe(false);
  expect(isNumericCsvColumn("amount", [`-${tiny}`])).toBe(false);
  expect(isNumericCsvColumn("amount", [`0.${"0".repeat(309)}1`])).toBe(false);
  expect(isNumericCsvColumn("amount", [`0.${"0".repeat(306)}1`])).toBe(true);
  expect(isNumericCsvColumn("amount", ["0", "0.000", "-0"])).toBe(true);
  // Identifier headers keep their digits as text.
  for (const header of [
    "id",
    "Customer ID",
    "customer_id",
    "customerId",
    "Phone",
    "ZIP",
    "postal code",
  ])
    expect(isNumericCsvColumn(header, ["123", "456"])).toBe(false);
  expect(isNumericCsvColumn("Paid", ["123"])).toBe(true);
});
