import { tableInsertRowSchema } from "@sokosumi/utils";
import { expect, it } from "vitest";
import {
  isPastedRange,
  pastedTableRows,
  tableImportBatches,
  tableInsertRows,
} from "./table-import";

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

const columns = [
  { id: "00000000-0000-4000-8000-000000000001", name: "Company", type: "text" },
  { id: "00000000-0000-4000-8000-000000000002", name: "Seats", type: "number" },
] as const;

it("lays pasted spreadsheet cells onto the columns and skips a header row", () => {
  expect(
    pastedTableRows([...columns], "company\tSeats\r\nAcme, Inc.\t3\nGlobex\n"),
  ).toEqual({ rows: [["Acme, Inc.", "3"], ["Globex"]], header: true });
  expect(pastedTableRows([...columns], "Acme\t3\n").header).toBe(false);
  expect(() => pastedTableRows([...columns], "a\tb\tc")).toThrow(
    "Pasted cells are wider than the table",
  );
});
it("parses text rows into insert rows and names the failing row", () => {
  expect(
    tableInsertRows([...columns], [["Globex"]], () => new Error()),
  ).toEqual([
    {
      values: { [columns[0].id]: "Globex", [columns[1].id]: null },
      evidence: {},
    },
  ]);
  expect(() =>
    tableInsertRows(
      [...columns],
      [
        ["Acme", "3"],
        ["Globex", "many"],
      ],
      (index) => new Error(`row ${index}`),
    ),
  ).toThrow("row 1");
});
it("treats only multi-cell clipboard text as a range", () => {
  expect(isPastedRange("Acme\n", { type: "text" })).toBe(false);
  expect(isPastedRange("Acme\tAcme Ltd", { type: "text" })).toBe(true);
  expect(isPastedRange("Acme\nGlobex", { type: "text" })).toBe(true);
  expect(isPastedRange("line one\nline two", { type: "long_text" })).toBe(
    false,
  );
});
