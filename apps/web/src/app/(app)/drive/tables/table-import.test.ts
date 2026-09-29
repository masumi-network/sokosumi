import { tableInsertRowSchema } from "@sokosumi/utils";
import { expect, it } from "vitest";
import { tableImportBatches } from "./table-import";

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
