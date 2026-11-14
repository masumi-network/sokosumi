import { SOKO_BOT_TOOL_INPUT_SCHEMAS } from "@sokosumi/soko-bot";
import { createDataTableSchema, validateTableValues } from "@sokosumi/utils";
import { describe, expect, it } from "vitest";
import { normalizeCreateTableInput } from "./table-create-input";

const nameId = "6d5e50a0-d465-4019-879d-7707b87e8a36";
const cityId = "8375fa87-84e4-4e3f-ae12-07a4c90b5719";
const scope = {
  workspaceId: "workspace-one",
  actorId: "bot-one",
  actorKind: "sokoBot" as const,
};
const input = {
  key: "table-exact-column-references",
  title: "Marketplaces",
  columns: [
    { id: nameId, name: "Name", type: "text" },
    { id: cityId, name: "City", type: "text" },
  ],
};

describe("Soko Bot initial table row references", () => {
  const withoutIds = {
    ...input,
    columns: [
      { name: "Name", type: "text" },
      { name: "City", type: "text" },
    ],
    rows: [
      {
        values: { Name: "Sokosumi" },
        evidence: { Name: [{ url: "https://sokosumi.com" }] },
      },
    ],
  };

  it("generates stable IDs for referenced name-only columns while retaining optional unused IDs", () => {
    const result = normalizeCreateTableInput(withoutIds, scope);
    const id = result.columns[0].id;
    expect(id).toEqual(expect.any(String));
    expect(result.rows[0].values).toEqual({ [id!]: "Sokosumi" });
    expect(result.rows[0].evidence).toEqual({
      [id!]: [{ url: "https://sokosumi.com" }],
    });
    expect(result.columns[1].id).toBeUndefined();
    expect(normalizeCreateTableInput(withoutIds, scope)).toEqual(result);
    expect(
      normalizeCreateTableInput(
        { ...withoutIds, rows: [] },
        scope,
      ).columns.every((column) => column.id === undefined),
    ).toBe(true);
  });

  it("scopes generated IDs to workspace, actor identity, kind and operation key", () => {
    const id = normalizeCreateTableInput(withoutIds, scope).columns[0].id;
    for (const other of [
      { ...scope, workspaceId: "workspace-two" },
      { ...scope, actorId: "bot-two" },
      { ...scope, actorKind: "coworker" as const },
    ]) {
      expect(
        normalizeCreateTableInput(withoutIds, other).columns[0].id,
      ).not.toBe(id);
    }
    expect(
      normalizeCreateTableInput(
        { ...withoutIds, key: "different-request" },
        scope,
      ).columns[0].id,
    ).not.toBe(id);
    expect(
      normalizeCreateTableInput(
        { ...withoutIds, title: "Changed payload" },
        scope,
      ).columns[0].id,
    ).toBe(id);
    expect(
      normalizeCreateTableInput(withoutIds, { ...scope, actorId: "one:two" })
        .columns[0].id,
    ).not.toBe(
      normalizeCreateTableInput(
        { ...withoutIds, key: `two:${withoutIds.key}` },
        { ...scope, actorId: "one" },
      ).columns[0].id,
    );
  });

  it("rejects a generated ID that collides with an explicit column ID", () => {
    const generated = normalizeCreateTableInput(withoutIds, scope).columns[0]
      .id;
    expect(() =>
      normalizeCreateTableInput(
        {
          ...withoutIds,
          columns: [
            withoutIds.columns[0],
            { ...withoutIds.columns[1], id: generated },
          ],
        },
        scope,
      ),
    ).toThrow("Column IDs must be unique");
  });

  it("maps exact unique names and their source evidence to declared IDs", () => {
    const result = normalizeCreateTableInput(
      {
        ...input,
        rows: [
          {
            values: { Name: "Sokosumi", City: "Berlin" },
            evidence: {
              Name: [{ url: "https://sokosumi.com" }],
            },
          },
        ],
      },
      scope,
    );
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
    expect(normalizeCreateTableInput({ ...input, rows }, scope).rows).toEqual(
      rows,
    );
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
        normalizeCreateTableInput({ ...input, rows: [row] }, scope),
      ).toThrow();
    },
  );

  it("rejects ambiguous names, including another column's exact ID", () => {
    for (const name of ["Name", nameId]) {
      expect(() =>
        normalizeCreateTableInput(
          {
            ...input,
            columns: [input.columns[0], { ...input.columns[1], name }],
            rows: [{ values: { [name]: "ambiguous" } }],
          },
          scope,
        ),
      ).toThrow("Ambiguous column reference");
    }
  });

  it("resolves declared names before assigning IDs that may look like another name", () => {
    const generated = normalizeCreateTableInput(withoutIds, scope).columns[0]
      .id!;
    const result = normalizeCreateTableInput(
      {
        ...withoutIds,
        columns: [
          withoutIds.columns[0],
          { ...input.columns[1], name: generated },
        ],
        rows: [{ values: { Name: "Sokosumi", [generated]: "Berlin" } }],
      },
      scope,
    );
    expect(result.rows[0].values).toEqual({
      [generated]: "Sokosumi",
      [cityId]: "Berlin",
    });
  });
});
