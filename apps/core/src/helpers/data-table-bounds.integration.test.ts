import { randomUUID } from "node:crypto";
import { createDataTableSchema, tableBatchSchema } from "@sokosumi/utils";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "@/lib/db/prisma";
import {
  batchTableRows,
  createDataTable,
  listDataTables,
  mutateDataTable,
  queryTableRows,
  saveTableView,
  type TableActor,
  undoTableBatch,
} from "./data-table";

// Bounds and fences that the other table suites do not reach: the saved-view
// cap and optimistic version, the archive fences on rows, tables and views,
// workspace-scoped listing pagination, and keyset paging over JSONB sort
// values that repeat or are unknown. Run against the isolated
// `native_tables` database described in docs/native-tables.md.
const enabled = process.env.RUN_DATABASE_INTEGRATION_TESTS === "true";

function requireIsolatedDatabase() {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    !url.pathname.includes("native_tables")
  )
    throw new Error("Use the isolated native_tables database");
}

async function createFixture(label: string) {
  const userId = randomUUID();
  const workspaceId = randomUUID();
  await prisma.user.create({
    data: {
      id: userId,
      name: label,
      email: `${label}-${userId}@sokosumi.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  await prisma.workspace.create({ data: { id: workspaceId, userId } });
  const actor: TableActor = {
    workspaceId,
    userId,
    actorId: userId,
    actorKind: "user",
  };
  return { actor, userId, workspaceId };
}

async function dropFixture(userId: string, workspaceId: string) {
  await prisma.workspace.deleteMany({ where: { id: workspaceId } });
  await prisma.user.deleteMany({ where: { id: userId } });
}

describe.runIf(enabled)("table bounds and fences", () => {
  let actor: TableActor;
  let userId = "";
  let workspaceId = "";
  let nameId = randomUUID();
  function input(key = randomUUID(), title = "Bounds") {
    nameId = randomUUID();
    return createDataTableSchema.parse({
      key,
      title,
      columns: [{ id: nameId, name: "Company", type: "text" }],
    });
  }
  beforeAll(async () => {
    requireIsolatedDatabase();
    const fixture = await createFixture("bounds");
    actor = fixture.actor;
    userId = fixture.userId;
    workspaceId = fixture.workspaceId;
  });
  afterAll(async () => {
    await dropFixture(userId, workspaceId);
  });

  it("saved views: version conflict, unknown column and the 50-view cap", async () => {
    const table = await createDataTable(actor, input());
    const view = await saveTableView(actor, table.id, {
      key: randomUUID(),
      name: "Mine",
      definition: { filters: [], sort: null, visibleColumnIds: [nameId] },
    });
    expect(view.version).toBe(1);
    const updated = await saveTableView(actor, table.id, {
      key: randomUUID(),
      id: view.id,
      version: 1,
      name: "Renamed",
      definition: { filters: [], sort: null, visibleColumnIds: [nameId] },
    });
    expect(updated.version).toBe(2);
    expect(updated.name).toBe("Renamed");
    await expect(
      saveTableView(actor, table.id, {
        key: randomUUID(),
        id: view.id,
        version: 1,
        name: "Stale",
        definition: { filters: [], sort: null, visibleColumnIds: [nameId] },
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      saveTableView(actor, table.id, {
        key: randomUUID(),
        name: "Bad column",
        definition: {
          filters: [],
          sort: null,
          visibleColumnIds: [randomUUID()],
        },
      }),
    ).rejects.toMatchObject({ status: 422 });
    for (let index = 1; index < 50; index++)
      await saveTableView(actor, table.id, {
        key: randomUUID(),
        name: `View ${index}`,
        definition: { filters: [], sort: null, visibleColumnIds: [nameId] },
      });
    expect(await prisma.tableView.count({ where: { tableId: table.id } })).toBe(
      50,
    );
    await expect(
      saveTableView(actor, table.id, {
        key: randomUUID(),
        name: "Fifty first",
        definition: { filters: [], sort: null, visibleColumnIds: [nameId] },
      }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("archive fences: table archive blocks edits, row archive blocks patches", async () => {
    const table = await createDataTable(actor, input());
    const inserted = await batchTableRows(actor, table.id, {
      key: randomUUID(),
      insert: [{ values: { [nameId]: "Acme" }, evidence: {} }],
      patch: [],
    });
    const row = inserted.rows[0];
    await batchTableRows(actor, table.id, {
      key: randomUUID(),
      insert: [],
      patch: [
        {
          id: row.id,
          version: row.version,
          values: {},
          evidence: {},
          archived: true,
        },
      ],
    });
    await expect(
      batchTableRows(actor, table.id, {
        key: randomUUID(),
        insert: [],
        patch: [
          {
            id: row.id,
            version: row.version + 1,
            values: { [nameId]: "Changed" },
            evidence: {},
          },
        ],
      }),
    ).rejects.toMatchObject({ status: 409 });
    const restored = await batchTableRows(actor, table.id, {
      key: randomUUID(),
      insert: [],
      patch: [
        {
          id: row.id,
          version: row.version + 1,
          values: { [nameId]: "Restored" },
          evidence: {},
          archived: false,
        },
      ],
    });
    expect(restored.rows[0].archivedAt).toBeNull();
    expect(restored.rows[0].values[nameId]).toBe("Restored");
    const archivedTable = await mutateDataTable(actor, table.id, {
      key: randomUUID(),
      version: table.version,
      archived: true,
    });
    await expect(
      batchTableRows(actor, table.id, {
        key: randomUUID(),
        insert: [{ values: { [nameId]: "After archive" }, evidence: {} }],
        patch: [],
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      saveTableView(actor, table.id, {
        key: randomUUID(),
        name: "On archived",
        definition: { filters: [], sort: null, visibleColumnIds: [nameId] },
      }),
    ).rejects.toMatchObject({ status: 409 });
    // Archived tables remain readable and restorable.
    const read = await queryTableRows(actor, table.id, { limit: 10 });
    expect(read.total).toBe(1);
    const back = await mutateDataTable(actor, table.id, {
      key: randomUUID(),
      version: archivedTable.version,
      archived: false,
    });
    expect(back.archivedAt).toBeNull();
  });

  it("listing: cursor pagination, archived and project filters stay workspace scoped", async () => {
    const project = await prisma.project.create({
      data: { workspaceId, name: "Probe project" },
    });
    const before = (await listDataTables(actor, { limit: 100 })).total;
    const first = await createDataTable(actor, input(randomUUID(), "L1"));
    await createDataTable(actor, input(randomUUID(), "L2"));
    const scoped = await createDataTable(actor, {
      ...input(randomUUID(), "L3"),
      projectId: project.id,
    });
    const all = await listDataTables(actor, { limit: 100 });
    expect(all.total).toBe(before + 3);
    const byProject = await listDataTables(actor, { projectId: project.id });
    expect(byProject.items.map((item) => item.id)).toEqual([scoped.id]);
    expect(byProject.total).toBe(1);
    const page = await listDataTables(actor, { limit: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBe(page.items[0].id);
    expect(page.total).toBe(before + 3);
    const next = await listDataTables(actor, {
      limit: 100,
      cursor: page.nextCursor ?? undefined,
    });
    expect(next.items.some((item) => item.id === page.items[0].id)).toBe(false);
    await mutateDataTable(actor, first.id, {
      key: randomUUID(),
      version: first.version,
      archived: true,
    });
    const archived = await listDataTables(actor, {
      archived: true,
      limit: 100,
    });
    expect(archived.items.map((item) => item.id)).toContain(first.id);
    const active = await listDataTables(actor, { limit: 100 });
    expect(active.items.map((item) => item.id)).not.toContain(first.id);
    // Another workspace cannot see these tables.
    const otherUser = await prisma.user.create({
      data: {
        id: randomUUID(),
        name: "Other",
        email: `other-${randomUUID()}@sokosumi.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const other = await prisma.workspace.create({
      data: { id: randomUUID(), userId: otherUser.id },
    });
    const foreign = await listDataTables(
      {
        workspaceId: other.id,
        userId: otherUser.id,
        actorId: otherUser.id,
        actorKind: "user",
      },
      { limit: 100 },
    );
    expect(foreign.total).toBe(0);
    await prisma.workspace.delete({ where: { id: other.id } });
    await prisma.user.delete({ where: { id: otherUser.id } });
  });

  it("listing: most recently changed first, with a column count instead of the schema", async () => {
    const older = await createDataTable(actor, input(randomUUID(), "Older"));
    const newer = await createDataTable(actor, input(randomUUID(), "Newer"));
    let page = await listDataTables(actor, { limit: 100 });
    expect(page.items.map((item) => item.id).slice(0, 2)).toEqual([
      newer.id,
      older.id,
    ]);
    expect(page.items[0]).toMatchObject({ title: "Newer", columnCount: 1 });
    expect(page.items[0]).not.toHaveProperty("columns");
    expect(page.items[0]).not.toHaveProperty("views");
    await batchTableRows(
      actor,
      older.id,
      tableBatchSchema.parse({
        key: randomUUID(),
        insert: [{ values: { [older.columns[0].id]: "Acme" } }],
      }),
    );
    page = await listDataTables(actor, { limit: 1 });
    expect(page.items.map((item) => item.id)).toEqual([older.id]);
    const next = await listDataTables(actor, {
      limit: 1,
      cursor: page.nextCursor ?? undefined,
    });
    expect(next.items.map((item) => item.id)).toEqual([newer.id]);
    const found = await listDataTables(actor, { search: "oLDe", limit: 100 });
    expect(found.items.map((item) => item.id)).toContain(older.id);
    expect(found.items.map((item) => item.id)).not.toContain(newer.id);
    await expect(
      listDataTables(actor, { cursor: randomUUID() }),
    ).rejects.toThrow("Invalid table cursor");
  });

  it("row order: moves rows, pages by position, renumbers and undoes a move", async () => {
    const table = await createDataTable(actor, {
      ...input(randomUUID(), "Ordered"),
      rows: ["a", "b", "c", "d"].map((name) => ({
        values: { [nameId]: name },
        evidence: {},
      })),
    });
    const columnId = table.columns[0].id;
    async function order() {
      const names: unknown[] = [];
      let cursor: string | undefined;
      do {
        const page = await queryTableRows(actor, table.id, {
          limit: 2,
          cursor,
        });
        names.push(...page.rows.map((row) => row.values[columnId]));
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      return names;
    }
    async function rows() {
      const { rows } = await queryTableRows(actor, table.id, { limit: 100 });
      return Object.fromEntries(
        rows.map((row) => [row.values[columnId] as string, row]),
      );
    }
    async function move(name: string, after: string | null) {
      const byName = await rows();
      return batchTableRows(
        actor,
        table.id,
        tableBatchSchema.parse({
          key: randomUUID(),
          patch: [
            {
              id: byName[name].id,
              version: byName[name].version,
              afterRowId: after ? byName[after].id : null,
            },
          ],
        }),
      );
    }
    expect(await order()).toEqual(["a", "b", "c", "d"]);
    await move("d", null);
    expect(await order()).toEqual(["d", "a", "b", "c"]);
    const moved = await move("a", "c");
    expect(await order()).toEqual(["d", "b", "c", "a"]);
    await expect(move("b", "b")).rejects.toThrow(
      "A row cannot move after itself",
    );
    // Equal neighbours leave no room in between, so the table is renumbered.
    await prisma.tableRow.updateMany({
      where: { tableId: table.id },
      data: { position: 7 },
    });
    await move("a", "b");
    const after = await order();
    expect(after.indexOf("a")).toBe(after.indexOf("b") + 1);
    const byName = await rows();
    for (const [index, name] of ["d", "b", "c", "a"].entries())
      await prisma.tableRow.update({
        where: { id: byName[name].id },
        data: { position: index + 1 },
      });
    expect(await order()).toEqual(["d", "b", "c", "a"]);
    // A later move of the same row blocks the undo, like any later edit.
    await expect(
      undoTableBatch(actor, table.id, {
        key: randomUUID(),
        batchId: moved.batchId,
      }),
    ).rejects.toThrow("changed later");
    const undoable = await move("b", null);
    expect(await order()).toEqual(["b", "d", "c", "a"]);
    await undoTableBatch(actor, table.id, {
      key: randomUUID(),
      batchId: undoable.batchId,
    });
    expect(await order()).toEqual(["d", "b", "c", "a"]);
  });
});

describe.runIf(enabled)("bounded keyset reads over JSONB values", () => {
  let actor: TableActor;
  let userId = "";
  let workspaceId = "";
  let tableId = "";
  let stage = "";
  let score = "";
  beforeAll(async () => {
    requireIsolatedDatabase();
    const fixture = await createFixture("reads");
    actor = fixture.actor;
    userId = fixture.userId;
    workspaceId = fixture.workspaceId;
    stage = randomUUID();
    score = randomUUID();
    const table = await createDataTable(
      actor,
      createDataTableSchema.parse({
        key: randomUUID(),
        title: "Pagination",
        columns: [
          { id: stage, name: "Stage", type: "text" },
          { id: score, name: "Score", type: "number" },
        ],
      }),
    );
    tableId = table.id;
    // Five rows share one sort value, three share another, two are unknown.
    const values = [
      ...Array.from({ length: 5 }, () => ({ [stage]: "same", [score]: 1 })),
      ...Array.from({ length: 3 }, () => ({ [stage]: "other", [score]: 2 })),
      ...Array.from({ length: 2 }, () => ({ [score]: 3 })),
    ];
    await batchTableRows(actor, tableId, {
      key: randomUUID(),
      insert: values.map((item) => ({ values: item, evidence: {} })),
      patch: [],
    });
  });
  afterAll(async () => {
    await dropFixture(userId, workspaceId);
    await prisma.$disconnect();
  });

  async function walk(
    direction: "asc" | "desc" | null,
    limit: number,
  ): Promise<string[]> {
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const result = await queryTableRows(actor, tableId, {
        limit,
        cursor,
        ...(direction ? { sort: { columnId: stage, direction } } : {}),
      });
      expect(result.total).toBe(10);
      seen.push(...result.rows.map((row) => row.id));
      if (!result.nextCursor) return seen;
      cursor = result.nextCursor;
    }
    throw new Error("pagination did not terminate");
  }

  it("walks every row exactly once with duplicate and unknown sort values", async () => {
    for (const direction of ["asc", "desc", null] as const) {
      const seen = await walk(direction, 3);
      expect(new Set(seen).size, `duplicate rows for ${direction}`).toBe(10);
      expect(seen).toHaveLength(10);
    }
  });

  it("keeps the sort order stable across pages", async () => {
    const paged = await walk("asc", 3);
    const single = await walk("asc", 100);
    expect(paged).toEqual(single);
    const descPaged = await walk("desc", 4);
    const descSingle = await walk("desc", 100);
    expect(descPaged).toEqual(descSingle);
  });

  it("filters on empty, equals and contains against JSONB values", async () => {
    const empty = await queryTableRows(actor, tableId, {
      limit: 100,
      filters: [{ columnId: stage, operator: "empty" }],
    });
    expect(empty.total).toBe(2);
    const equals = await queryTableRows(actor, tableId, {
      limit: 100,
      filters: [{ columnId: stage, operator: "equals", value: "same" }],
    });
    expect(equals.total).toBe(5);
    const contains = await queryTableRows(actor, tableId, {
      limit: 100,
      filters: [{ columnId: stage, operator: "contains", value: "AM" }],
    });
    expect(contains.total).toBe(5);
    const numeric = await queryTableRows(actor, tableId, {
      limit: 100,
      filters: [{ columnId: score, operator: "equals", value: 2 }],
    });
    expect(numeric.total).toBe(3);
    const rowIds = equals.rows.slice(0, 2).map((row) => row.id);
    const restricted = await queryTableRows(actor, tableId, {
      limit: 100,
      rowIds,
    });
    expect(restricted.total).toBe(2);
    expect(restricted.rows.map((row) => row.id).sort()).toEqual(
      [...rowIds].sort(),
    );
  });
});
