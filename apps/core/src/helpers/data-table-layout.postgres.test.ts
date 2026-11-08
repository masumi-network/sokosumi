/**
 * Column width and wrap are the table view's shared layout. They travel on the
 * table's own column update (`mutateDataTable`), so they get its version check,
 * and a writer that lists columns without them — a Soko Bot renaming a column —
 * must leave them as they are.
 */
import { randomUUID } from "node:crypto";
import { tableMutationSchema } from "@sokosumi/utils";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "@/lib/db/prisma";
import {
  createDataTable,
  mutateDataTable,
  requireDataTable,
  type TableActor,
} from "./data-table";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const userId = randomUUID();
const workspaceId = randomUUID();
const actor: TableActor = {
  workspaceId,
  userId,
  actorId: userId,
  actorKind: "user",
};

describe.runIf(enabled)("table column layout on PostgreSQL", () => {
  beforeAll(async () => {
    await prisma.user.create({
      data: {
        id: userId,
        name: "Layout test",
        email: `layout-${userId}@sokosumi.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    await prisma.workspace.create({ data: { id: workspaceId, userId } });
  });
  afterAll(async () => {
    await prisma.dataTable.deleteMany({ where: { workspaceId } });
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("persists width and wrap, keeps them when a write omits them, and checks the version", async () => {
    const nameId = randomUUID();
    const priceId = randomUUID();
    const table = await createDataTable(actor, {
      key: randomUUID(),
      title: "Contacts",
      description: "",
      columns: [
        {
          id: nameId,
          name: "Company",
          type: "text",
          description: "",
          options: [],
        },
        {
          id: priceId,
          name: "Price",
          type: "number",
          description: "",
          options: [],
        },
      ],
      rows: [],
    });
    expect(table.columns[0]).toMatchObject({ width: null, wrap: null });

    const resized = await mutateDataTable(
      actor,
      table.id,
      tableMutationSchema.parse({
        key: randomUUID(),
        version: table.version,
        columns: [
          { ...table.columns[0], width: 312, wrap: true },
          table.columns[1],
        ],
      }),
    );
    expect(resized.columns[0]).toMatchObject({ width: 312, wrap: true });
    expect(resized.columns[1]).toMatchObject({ width: null, wrap: null });

    const renamed = await mutateDataTable(
      actor,
      table.id,
      tableMutationSchema.parse({
        key: randomUUID(),
        version: resized.version,
        columns: [
          { id: nameId, name: "Name", type: "text" },
          { id: priceId, name: "Price", type: "number" },
        ],
      }),
    );
    expect(renamed.columns[0]).toMatchObject({
      name: "Name",
      width: 312,
      wrap: true,
    });
    const stored = await requireDataTable(actor, table.id);
    expect(stored.columns[0]).toMatchObject({ width: 312, wrap: true });

    // A layout save made against an older version is a conflict, not a
    // silent overwrite of someone else's change.
    await expect(
      mutateDataTable(
        actor,
        table.id,
        tableMutationSchema.parse({
          key: randomUUID(),
          version: resized.version,
          columns: [{ ...renamed.columns[0], width: 200 }, renamed.columns[1]],
        }),
      ),
    ).rejects.toThrow("Reload");

    const reset = await mutateDataTable(
      actor,
      table.id,
      tableMutationSchema.parse({
        key: randomUUID(),
        version: renamed.version,
        columns: [
          { ...renamed.columns[0], width: null, wrap: false },
          renamed.columns[1],
        ],
      }),
    );
    expect(reset.columns[0]).toMatchObject({ width: null, wrap: false });
  });

  it("rejects widths outside 80–800 pixels", () => {
    for (const width of [79, 801, 120.5])
      expect(() =>
        tableMutationSchema.parse({
          key: randomUUID(),
          version: 1,
          columns: [{ name: "Company", type: "text", width }],
        }),
      ).toThrow();
  });

  it("creates a Core-built table with many rows in one write, in order", async () => {
    const nameId = randomUUID();
    const columns = [
      {
        id: nameId,
        name: "Name",
        type: "text" as const,
        description: "",
        options: [],
      },
    ];
    const rows = Array.from({ length: 250 }, (_, index) => ({
      values: { [nameId]: `Person ${index}` },
      evidence: {},
    }));
    await expect(
      createDataTable(actor, {
        key: randomUUID(),
        title: "Too many",
        description: "",
        columns,
        rows,
      }),
    ).rejects.toThrow();
    const table = await createDataTable(
      actor,
      { key: randomUUID(), title: "Export", description: "", columns, rows },
      undefined,
      { manyRows: true },
    );
    const stored = await prisma.tableRow.findMany({
      where: { tableId: table.id },
      orderBy: [{ position: "asc" }, { id: "asc" }],
    });
    expect(stored).toHaveLength(250);
    expect((stored[0]?.values as Record<string, string>)[nameId]).toBe(
      "Person 0",
    );
    expect((stored[249]?.values as Record<string, string>)[nameId]).toBe(
      "Person 249",
    );
    expect(
      await prisma.tableChange.count({
        where: { tableId: table.id, rowId: { not: null } },
      }),
    ).toBe(250);
  });
});
