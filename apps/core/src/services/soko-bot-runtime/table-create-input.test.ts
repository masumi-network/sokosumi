import { SOKO_BOT_TOOL_INPUT_SCHEMAS } from "@sokosumi/soko-bot";
import { createDataTableSchema, validateTableValues } from "@sokosumi/utils";
import { describe, expect, it } from "vitest";
import { normalizeCreateTableInput } from "./table-create-input";

const nameId = "6d5e50a0-d465-4019-879d-7707b87e8a36";
const cityId = "8375fa87-84e4-4e3f-ae12-07a4c90b5719";
const input = {
  key: "table-exact-column-references",
  title: "Marketplaces",
  columns: [
    { id: nameId, name: "Name", type: "text" },
    { id: cityId, name: "City", type: "text" },
  ],
};

describe("Soko Bot initial table row references", () => {
  it("maps exact unique names and their source evidence to declared IDs", () => {
    const result = normalizeCreateTableInput({
      ...input,
      rows: [
        {
          values: { Name: "Sokosumi", City: "Berlin" },
          evidence: {
            Name: [{ url: "https://sokosumi.com" }],
          },
        },
      ],
    });
    expect(result.rows[0]).toEqual({
      values: { [nameId]: "Sokosumi", [cityId]: "Berlin" },
      evidence: { [nameId]: [{ url: "https://sokosumi.com" }] },
    });
    expect(createDataTableSchema.parse(result)).toEqual(result);
    validateTableValues(
      result.columns.map((column) => ({ ...column, id: column.id! })),
      result.rows[0].values,
      result.rows[0].evidence,
    );
  });

  it("preserves exact IDs and leaves later writes restricted to IDs", () => {
    const rows = [{ values: { [nameId]: "Sokosumi" }, evidence: {} }];
    expect(normalizeCreateTableInput({ ...input, rows }).rows).toEqual(rows);
    expect(
      SOKO_BOT_TOOL_INPUT_SCHEMAS.write_table_rows.safeParse({
        key: "later-write",
        tableId: nameId,
        insert: [{ values: { Name: "Sokosumi" } }],
      }).success,
    ).toBe(false);
  });

  it.each([
    { values: { name: "Sokosumi" } },
    { values: { "6d5e50a0-d465-4e3f-ae12-07a4c90b5719": "Sokosumi" } },
    { values: { Name: "Sokosumi", [nameId]: "Other" } },
    {
      values: { Name: "Sokosumi" },
      evidence: { city: [{ url: "https://example.com" }] },
    },
  ])(
    "rejects unknown, mistyped, and duplicate references without guessing",
    (row) => {
      expect(() =>
        normalizeCreateTableInput({ ...input, rows: [row] }),
      ).toThrow();
    },
  );

  it("rejects ambiguous names, including another column's exact ID", () => {
    for (const name of ["Name", nameId]) {
      expect(() =>
        normalizeCreateTableInput({
          ...input,
          columns: [input.columns[0], { ...input.columns[1], name }],
          rows: [{ values: { [name]: "ambiguous" } }],
        }),
      ).toThrow("Ambiguous column reference");
    }
  });

  it("does not accept name references without an explicit stable column ID", () => {
    expect(() =>
      normalizeCreateTableInput({
        ...input,
        columns: [{ name: "Name", type: "text" }],
        rows: [{ values: { Name: "Sokosumi" } }],
      }),
    ).toThrow("stable column ID");
    expect(
      normalizeCreateTableInput({
        ...input,
        columns: [{ name: "Name", type: "text" }],
      }).rows,
    ).toEqual([]);
  });
});
