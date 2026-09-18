import { randomUUID } from "node:crypto";
import {
  createDataTableSchema,
  tableBatchSchema,
  tableMutationSchema,
} from "@sokosumi/utils";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import prisma from "@/lib/db/prisma";
import {
  batchTableRows,
  createDataTable,
  createTableEnrichment,
  listDataTables,
  mutateDataTable,
  queryTableRows,
  requireDataTable,
  resolveTableActor,
  type TableActor,
  undoTableBatch,
} from "./data-table";

const enabled = process.env.RUN_DATABASE_INTEGRATION_TESTS === "true";
const userId = randomUUID();
const workspaceId = randomUUID();
const actor: TableActor = {
  workspaceId,
  userId,
  actorId: userId,
  actorKind: "user",
};
let nameId = randomUUID();
let numberId = randomUUID();
function input(key = randomUUID()) {
  return createDataTableSchema.parse({
    key,
    title: "Research",
    columns: [
      { id: nameId, name: "Company", type: "text" },
      { id: numberId, name: "Price", type: "number" },
    ],
  });
}

describe.runIf(enabled)("native tables PostgreSQL invariants", () => {
  beforeEach(() => {
    nameId = randomUUID();
    numberId = randomUUID();
  });
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (
      !["localhost", "127.0.0.1"].includes(url.hostname) ||
      !url.pathname.includes("native_tables")
    )
      throw new Error("Use the isolated native_tables database");
    await prisma.user.create({
      data: {
        id: userId,
        name: "Table test",
        email: `table-${userId}@sokosumi.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    await prisma.workspace.create({ data: { id: workspaceId, userId } });
  });
  afterAll(async () => {
    await prisma.task.deleteMany({ where: { workspaceId } });
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });
  it("returns the same resource after a lost acknowledgement and rejects changed retry input", async () => {
    const body = input();
    const first = await createDataTable(actor, body);
    const retried = await createDataTable(actor, body);
    expect(retried.id).toBe(first.id);
    expect(await prisma.dataTable.count({ where: { workspaceId } })).toBe(1);
    await expect(
      createDataTable(actor, { ...body, title: "Other" }),
    ).rejects.toThrow("Retry key");
  });
  it("deduplicates concurrent inserts and keeps audit atomic", async () => {
    const table = await createDataTable(actor, input());
    const batch = tableBatchSchema.parse({
      key: randomUUID(),
      insert: [{ values: { [nameId]: "Acme", [numberId]: 42 } }],
    });
    const results = await Promise.all([
      batchTableRows(actor, table.id, batch),
      batchTableRows(actor, table.id, batch),
    ]);
    expect(results[0].batchId).toBe(results[1].batchId);
    expect(await prisma.tableRow.count({ where: { tableId: table.id } })).toBe(
      1,
    );
    expect(
      await prisma.tableChange.count({
        where: { tableId: table.id, batchId: results[0].batchId },
      }),
    ).toBe(1);
  }, 15000);
  it("rolls back an entire invalid batch including history", async () => {
    const table = await createDataTable(actor, input());
    const before = await prisma.tableChange.count({
      where: { tableId: table.id },
    });
    await expect(
      batchTableRows(
        actor,
        table.id,
        tableBatchSchema.parse({
          key: randomUUID(),
          insert: [
            { values: { [nameId]: "valid" } },
            { values: { [numberId]: "invalid" } },
          ],
        }),
      ),
    ).rejects.toThrow("Invalid number");
    expect(await prisma.tableRow.count({ where: { tableId: table.id } })).toBe(
      0,
    );
    expect(
      await prisma.tableChange.count({ where: { tableId: table.id } }),
    ).toBe(before);
  });
  it("rejects stale edits, and undo preserves a later edit in another column", async () => {
    const table = await createDataTable(actor, input());
    const inserted = await batchTableRows(
      actor,
      table.id,
      tableBatchSchema.parse({
        key: randomUUID(),
        insert: [{ values: { [nameId]: "Original", [numberId]: 1 } }],
      }),
    );
    const row = inserted.rows[0];
    const agentEdit = await batchTableRows(
      { ...actor, actorKind: "sokoBot", ownerChat: true },
      table.id,
      tableBatchSchema.parse({
        key: randomUUID(),
        patch: [
          {
            id: row.id,
            version: 1,
            values: { [numberId]: 2 },
            evidence: { [numberId]: [{ url: "https://example.com/pricing" }] },
          },
        ],
      }),
    );
    await expect(
      batchTableRows(
        actor,
        table.id,
        tableBatchSchema.parse({
          key: randomUUID(),
          patch: [{ id: row.id, version: 1, values: { [nameId]: "stale" } }],
        }),
      ),
    ).rejects.toThrow("Row changed");
    await batchTableRows(
      actor,
      table.id,
      tableBatchSchema.parse({
        key: randomUUID(),
        patch: [{ id: row.id, version: 2, values: { [nameId]: "Human edit" } }],
      }),
    );
    await undoTableBatch(actor, table.id, {
      key: randomUUID(),
      batchId: agentEdit.batchId,
    });
    const result = await queryTableRows(actor, table.id, {});
    expect(result.rows[0].values).toEqual({
      [nameId]: "Human edit",
      [numberId]: 1,
    });
    expect(result.rows[0].evidence[numberId]).toEqual([]);
  });
  it("refuses undo if the same cell changed later", async () => {
    const table = await createDataTable(actor, input());
    const inserted = await batchTableRows(
      actor,
      table.id,
      tableBatchSchema.parse({
        key: randomUUID(),
        insert: [{ values: { [numberId]: 1 } }],
      }),
    );
    const row = inserted.rows[0];
    const edit = await batchTableRows(
      actor,
      table.id,
      tableBatchSchema.parse({
        key: randomUUID(),
        patch: [{ id: row.id, version: 1, values: { [numberId]: 2 } }],
      }),
    );
    await batchTableRows(
      actor,
      table.id,
      tableBatchSchema.parse({
        key: randomUUID(),
        patch: [{ id: row.id, version: 2, values: { [numberId]: 3 } }],
      }),
    );
    await expect(
      undoTableBatch(actor, table.id, {
        key: randomUUID(),
        batchId: edit.batchId,
      }),
    ).rejects.toThrow("changed later");
  });
  it("rejects another workspace for schema, query, writes and retry lookup", async () => {
    const table = await createDataTable(actor, input());
    const stranger = { ...actor, workspaceId: randomUUID() };
    await expect(requireDataTable(stranger, table.id)).rejects.toThrow(
      "not found",
    );
    await expect(queryTableRows(stranger, table.id, {})).rejects.toThrow(
      "not found",
    );
    await expect(
      batchTableRows(
        stranger,
        table.id,
        tableBatchSchema.parse({ key: randomUUID(), insert: [{ values: {} }] }),
      ),
    ).rejects.toThrow("not found");
    expect((await listDataTables(stranger)).items).toEqual([]);
  });
  it("keeps IDs through rename/reorder and refuses lossy type changes", async () => {
    const table = await createDataTable(actor, input());
    await batchTableRows(
      actor,
      table.id,
      tableBatchSchema.parse({
        key: randomUUID(),
        insert: [{ values: { [numberId]: 1 } }],
      }),
    );
    const columns = [{ ...table.columns[1], name: "Cost" }, table.columns[0]];
    const next = await mutateDataTable(
      actor,
      table.id,
      tableMutationSchema.parse({ key: randomUUID(), version: 1, columns }),
    );
    expect(next.columns.map((column) => column.id)).toEqual([numberId, nameId]);
    await expect(
      mutateDataTable(
        actor,
        table.id,
        tableMutationSchema.parse({
          key: randomUUID(),
          version: 2,
          columns: [{ ...columns[0], type: "text" }, columns[1]],
        }),
      ),
    ).rejects.toThrow("populated column");
  });
  it("server-filters and sorts numeric JSON values with bounded keyset pagination", async () => {
    const table = await createDataTable(actor, input());
    await batchTableRows(
      actor,
      table.id,
      tableBatchSchema.parse({
        key: randomUUID(),
        insert: [10, 2, 1].map((value) => ({
          values: { [nameId]: "Acme", [numberId]: value },
        })),
      }),
    );
    const first = await queryTableRows(actor, table.id, {
      limit: 2,
      sort: { columnId: numberId, direction: "asc" },
      filters: [{ columnId: nameId, operator: "equals", value: "Acme" }],
    });
    expect(first.rows.map((row) => row.values[numberId])).toEqual([1, 2]);
    const second = await queryTableRows(actor, table.id, {
      limit: 2,
      cursor: first.nextCursor!,
      sort: { columnId: numberId, direction: "asc" },
    });
    expect(second.rows.map((row) => row.values[numberId])).toEqual([10]);
  });
  it("enforces selected rows and columns even when a bot omits task context", async () => {
    const table = await createDataTable(actor, input());
    const inserted = await batchTableRows(
      actor,
      table.id,
      tableBatchSchema.parse({
        key: randomUUID(),
        insert: [
          { values: { [nameId]: "Selected" } },
          { values: { [nameId]: "Other" } },
        ],
      }),
    );
    const bot = await prisma.sokoBot.create({ data: { userId, workspaceId } });
    const task = await prisma.task.create({
      data: {
        ownerId: userId,
        creatorUserId: userId,
        workspaceId,
        name: "Enrich selection",
        status: "RUNNING",
        assigneeSokoBotId: bot.id,
      },
    });
    await prisma.tableTaskScope.create({
      data: {
        tableId: table.id,
        taskId: task.id,
        rowIds: [inserted.rows[0].id],
        columnIds: [numberId],
        createdBy: userId,
      },
    });
    const agent = { ...actor, actorKind: "sokoBot" as const, actorId: bot.id };
    const patch = tableBatchSchema.parse({
      key: randomUUID(),
      patch: [
        { id: inserted.rows[0].id, version: 1, values: { [numberId]: 3 } },
      ],
    });
    await expect(batchTableRows(agent, table.id, patch)).rejects.toThrow(
      "task ID",
    );
    const scoped = { ...agent, taskId: task.id };
    await expect(
      batchTableRows(
        scoped,
        table.id,
        tableBatchSchema.parse({
          key: randomUUID(),
          patch: [
            { id: inserted.rows[1].id, version: 1, values: { [numberId]: 3 } },
          ],
        }),
      ),
    ).rejects.toThrow("exceeds");
    await expect(
      batchTableRows(
        scoped,
        table.id,
        tableBatchSchema.parse({
          key: randomUUID(),
          patch: [
            {
              id: inserted.rows[0].id,
              version: 1,
              values: { [nameId]: "unauthorized" },
            },
          ],
        }),
      ),
    ).rejects.toThrow("exceeds");
    await expect(
      batchTableRows(
        scoped,
        table.id,
        tableBatchSchema.parse({ key: randomUUID(), insert: [{ values: {} }] }),
      ),
    ).rejects.toThrow("cannot insert");
    await expect(
      mutateDataTable(
        agent,
        table.id,
        tableMutationSchema.parse({
          key: randomUUID(),
          version: 1,
          title: "bypass",
        }),
      ),
    ).rejects.toThrow("task ID");
    await batchTableRows(scoped, table.id, patch);
    expect(
      (await queryTableRows(scoped, table.id, {})).rows.map((row) => row.id),
    ).toEqual([inserted.rows[0].id]);
    await prisma.task.update({
      where: { id: task.id },
      data: { assigneeSokoBotId: null },
    });
    await expect(batchTableRows(scoped, table.id, patch)).rejects.toThrow(
      "not assigned",
    );
    await prisma.sokoBot.delete({ where: { id: bot.id } });
  });
  it("derives workspace authority from membership, not supplied actor IDs", async () => {
    const auth = {
      actor: "user" as const,
      userId,
      organizationId: null,
      role: "user",
      authenticationMethod: "session" as const,
    };
    expect((await resolveTableActor(auth, workspaceId)).userId).toBe(userId);
    await expect(
      resolveTableActor({ ...auth, userId: randomUUID() }, workspaceId),
    ).rejects.toThrow("owner required");
    const organization = await prisma.organization.create({
      data: {
        name: "Table isolation",
        slug: randomUUID(),
        createdAt: new Date(),
      },
    });
    const workspace = await prisma.workspace.create({
      data: { organizationId: organization.id },
    });
    try {
      await expect(
        resolveTableActor(
          { ...auth, organizationId: organization.id },
          workspace.id,
        ),
      ).rejects.toThrow("membership required");
      await prisma.member.create({
        data: {
          userId,
          organizationId: organization.id,
          role: "member",
          createdAt: new Date(),
        },
      });
      expect(
        (
          await resolveTableActor(
            { ...auth, organizationId: organization.id },
            workspace.id,
          )
        ).workspaceId,
      ).toBe(workspace.id);
      await prisma.member.deleteMany({
        where: { userId, organizationId: organization.id },
      });
      await expect(
        resolveTableActor(
          { ...auth, organizationId: organization.id },
          workspace.id,
        ),
      ).rejects.toThrow("membership required");
    } finally {
      await prisma.organization.delete({ where: { id: organization.id } });
    }
  });
  it("undoes a batch with multiple cells and archive without conflicting with its own audit", async () => {
    const table = await createDataTable(actor, input());
    const inserted = await batchTableRows(
      actor,
      table.id,
      tableBatchSchema.parse({
        key: randomUUID(),
        insert: [{ values: { [nameId]: "Before", [numberId]: 1 } }],
      }),
    );
    const changed = await batchTableRows(
      actor,
      table.id,
      tableBatchSchema.parse({
        key: randomUUID(),
        patch: [
          {
            id: inserted.rows[0].id,
            version: 1,
            values: { [nameId]: "After", [numberId]: 2 },
            archived: true,
          },
        ],
      }),
    );
    await undoTableBatch(actor, table.id, {
      key: randomUUID(),
      batchId: changed.batchId,
    });
    const result = await queryTableRows(actor, table.id, {});
    expect(result.rows[0].values).toEqual({
      [nameId]: "Before",
      [numberId]: 1,
    });
    expect(result.rows[0].archivedAt).toBeNull();
    await expect(
      undoTableBatch(actor, table.id, {
        key: randomUUID(),
        batchId: inserted.batchId,
      }),
    ).rejects.toThrow("changed later");
  });
  it("allows adding select options without losing populated values", async () => {
    const body = input();
    const table = await createDataTable(actor, {
      ...body,
      columns: [
        {
          id: nameId,
          name: "Stage",
          description: "",
          type: "single_select",
          options: ["New"],
        },
      ],
    });
    await batchTableRows(
      actor,
      table.id,
      tableBatchSchema.parse({
        key: randomUUID(),
        insert: [{ values: { [nameId]: "New" } }],
      }),
    );
    await mutateDataTable(
      actor,
      table.id,
      tableMutationSchema.parse({
        key: randomUUID(),
        version: 1,
        columns: [{ ...table.columns[0], options: ["New", "Qualified"] }],
      }),
    );
    expect(
      (await queryTableRows(actor, table.id, {})).rows[0].values[nameId],
    ).toBe("New");
    await expect(
      mutateDataTable(
        actor,
        table.id,
        tableMutationSchema.parse({
          key: randomUUID(),
          version: 2,
          columns: [{ ...table.columns[0], options: ["Qualified"] }],
        }),
      ),
    ).rejects.toThrow("populated column");
  });
  it("bounds filtered reads at the 10,000-row limit and preserves completed batches after failure", async () => {
    const table = await createDataTable(actor, input());
    // Seed representative storage directly; mutations and retry/audit are exercised above.
    await prisma.$executeRaw`INSERT INTO table_row (id, "tableId", values, evidence, "updatedAt") SELECT gen_random_uuid(), ${table.id}::uuid, jsonb_build_object(${nameId}::text, 'Company ' || n, ${numberId}::text, n), '{}'::jsonb, NOW() FROM generate_series(0,9999) AS n`;
    const timings: number[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const started = performance.now();
      const result = await queryTableRows(actor, table.id, {
        limit: 100,
        cursor,
        sort: { columnId: numberId, direction: "asc" },
        filters: [{ columnId: nameId, operator: "contains", value: "Company" }],
      });
      timings.push(performance.now() - started);
      expect(result.rows).toHaveLength(100);
      expect(result.rows[0].values[numberId]).toBe(page * 100);
      cursor = result.nextCursor ?? undefined;
    }
    timings.sort((a, b) => a - b);
    process.stdout.write(
      "NATIVE_TABLES_BENCHMARK " +
        JSON.stringify({
          rows: 10000,
          pageSize: 100,
          samples: timings.length,
          p50Ms: Math.round(timings[5]),
          p95Ms: Math.round(timings[9]),
        }) +
        "\n",
    );
    await expect(
      batchTableRows(
        actor,
        table.id,
        tableBatchSchema.parse({
          key: randomUUID(),
          insert: [{ values: { [nameId]: "Overflow" } }],
        }),
      ),
    ).rejects.toThrow("10,000");
    expect(await prisma.tableRow.count({ where: { tableId: table.id } })).toBe(
      10000,
    );
  }, 60000);
  it("atomically creates an assigned enrichment task, exact scope and live reference with retry safety", async () => {
    const table = await createDataTable(actor, input());
    const inserted = await batchTableRows(
      actor,
      table.id,
      tableBatchSchema.parse({
        key: randomUUID(),
        insert: [{ values: { [nameId]: "Research me" } }],
      }),
    );
    const bot = await prisma.sokoBot.create({ data: { userId, workspaceId } });
    const request = {
      key: randomUUID(),
      prompt: "Find pricing and include sources",
      rowIds: [inserted.rows[0].id],
      columnIds: [numberId],
      assigneeSokoBotId: bot.id,
    };
    const result = await createTableEnrichment(actor, table.id, request);
    expect(await createTableEnrichment(actor, table.id, request)).toEqual(
      result,
    );
    const task = await prisma.task.findUniqueOrThrow({
      where: { id: result.taskId },
      include: { tableScope: true, events: true },
    });
    expect(task.status).toBe("READY");
    expect(task.assigneeSokoBotId).toBe(bot.id);
    expect(task.description).toContain(
      `[Open table](/drive/tables/${table.id})`,
    );
    expect(task.tableScope).toMatchObject({
      rowIds: request.rowIds,
      columnIds: request.columnIds,
      tableId: table.id,
    });
    expect(task.events).toHaveLength(1);
    await prisma.task.update({
      where: { id: task.id },
      data: { status: "COMPLETED" },
    });
    await expect(
      batchTableRows(
        { ...actor, actorKind: "sokoBot", actorId: bot.id, taskId: task.id },
        table.id,
        tableBatchSchema.parse({
          key: randomUUID(),
          patch: [
            { id: inserted.rows[0].id, version: 1, values: { [numberId]: 1 } },
          ],
        }),
      ),
    ).rejects.toThrow("not assigned");
    await prisma.sokoBot.delete({ where: { id: bot.id } });
  });
});
