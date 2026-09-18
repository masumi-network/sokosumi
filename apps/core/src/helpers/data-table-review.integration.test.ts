import { randomUUID } from "node:crypto";
import {
  createDataTableSchema,
  tableBatchSchema,
  tableMutationSchema,
} from "@sokosumi/utils";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  batchTableRows,
  createDataTable,
  createTableEnrichment,
  mutateDataTable,
  queryTableRows,
  type TableActor,
  undoTableBatch,
} from "@/helpers/data-table";
import prisma from "@/lib/db/prisma";

const userId = randomUUID(),
  workspaceId = randomUUID();
const actor: TableActor = {
  userId,
  workspaceId,
  actorId: userId,
  actorKind: "user",
};
describe.runIf(process.env.RUN_DATABASE_INTEGRATION_TESTS === "true")(
  "table review regressions",
  () => {
    beforeAll(async () => {
      if (
        process.env.RUN_DATABASE_INTEGRATION_TESTS !== "true" ||
        !(
          ["127.0.0.1", "localhost"].includes(
            new URL(process.env.DATABASE_URL!).hostname,
          ) &&
          new URL(process.env.DATABASE_URL!).pathname.includes("native_tables")
        )
      )
        throw Error("Own isolated database required");
      await prisma.user.create({
        data: {
          id: userId,
          email: `${userId}@fixture.invalid`,
          name: "Review fixture",
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      await prisma.workspace.create({ data: { id: workspaceId, userId } });
    });
    afterAll(async () => {
      await prisma.task.deleteMany({ where: { workspaceId } });
      await prisma.workspace.delete({ where: { id: workspaceId } });
      await prisma.user.delete({ where: { id: userId } });
      await prisma.$disconnect();
    });
    async function make(types: string[] = ["text"]) {
      return createDataTable(
        actor,
        createDataTableSchema.parse({
          key: randomUUID(),
          title: "Probe",
          columns: types.map((type) => ({
            id: randomUUID(),
            name: type,
            type,
          })),
        }),
      );
    }
    async function insert(tableId: string, values: Record<string, unknown>) {
      return batchTableRows(
        actor,
        tableId,
        tableBatchSchema.parse({ key: randomUUID(), insert: [{ values }] }),
      );
    }
    it("F10: an unknown-only column can change type", async () => {
      const table = await make(),
        c = table.columns[0].id;
      await insert(table.id, { [c]: null });
      expect(
        (
          await mutateDataTable(
            actor,
            table.id,
            tableMutationSchema.parse({
              key: randomUUID(),
              version: 1,
              columns: [{ ...table.columns[0], type: "number" }],
            }),
          )
        ).columns[0].type,
      ).toBe("number");
    });
    it("rejects oversized row requests atomically (CSV must split them)", async () => {
      const table = await make(["long_text"]),
        c = table.columns[0].id;
      const body = tableBatchSchema.parse({
        key: randomUUID(),
        insert: Array.from({ length: 60 }, () => ({
          values: { [c]: "x".repeat(20000) },
        })),
      });
      expect(Buffer.byteLength(JSON.stringify(body))).toBeGreaterThan(
        1_000_000,
      );
      await expect(batchTableRows(actor, table.id, body)).rejects.toThrow(
        "1 MB",
      );
      expect(
        await prisma.tableRow.count({ where: { tableId: table.id } }),
      ).toBe(0);
    });
    it("F8: undo rejects an oversized final row atomically", async () => {
      const table = await make([
        "long_text",
        "long_text",
        "long_text",
        "long_text",
      ]);
      const [a, b, c, d] = table.columns.map((c) => c.id),
        big = "x".repeat(19000);
      const initial = await insert(table.id, { [a]: big, [b]: big, [c]: big });
      const id = initial.rows[0].id;
      const cleared = await batchTableRows(
        actor,
        table.id,
        tableBatchSchema.parse({
          key: randomUUID(),
          patch: [{ id, version: 1, values: { [a]: null } }],
        }),
      );
      await batchTableRows(
        actor,
        table.id,
        tableBatchSchema.parse({
          key: randomUUID(),
          patch: [{ id, version: 2, values: { [d]: big } }],
        }),
      );
      await expect(
        undoTableBatch(actor, table.id, {
          key: randomUUID(),
          batchId: cleared.batchId,
        }),
      ).rejects.toThrow();
      const row = (await queryTableRows(actor, table.id, {})).rows[0];
      expect(row.version).toBe(3);
      expect(row.values[a]).toBeNull();
      expect(row.values[d]).toBe(big);
      expect(
        await prisma.tableChange.count({ where: { rowId: id, columnId: a } }),
      ).toBe(1);
    });
    it("F1: missing task context cannot broaden reads or bypass terminal tasks", async () => {
      const table = await make(),
        other = await make(),
        c = table.columns[0].id;
      const row = (await insert(table.id, { [c]: "selected" })).rows[0];
      await insert(other.id, { [other.columns[0].id]: "outside selection" });
      const bot =
        (await prisma.sokoBot.findFirst({ where: { userId, workspaceId } })) ??
        (await prisma.sokoBot.create({ data: { userId, workspaceId } }));
      const task = await createTableEnrichment(actor, table.id, {
        key: randomUUID(),
        prompt: "Only selected cells",
        rowIds: [row.id],
        columnIds: [c],
        assigneeSokoBotId: bot.id,
      });
      const agent: TableActor = {
        ...actor,
        actorKind: "sokoBot",
        actorId: bot.id,
      };
      await expect(
        queryTableRows({ ...agent, taskId: task.taskId }, other.id, {}),
      ).rejects.toThrow("another table");
      await expect(queryTableRows(agent, other.id, {})).rejects.toThrow(
        "assigned task",
      );
      await prisma.task.update({
        where: { id: task.taskId },
        data: { status: "COMPLETED" },
      });
      await expect(
        batchTableRows(
          { ...agent, taskId: task.taskId },
          table.id,
          tableBatchSchema.parse({
            key: randomUUID(),
            insert: [{ values: {} }],
          }),
        ),
      ).rejects.toThrow("not assigned");
      await expect(
        batchTableRows(
          agent,
          table.id,
          tableBatchSchema.parse({
            key: randomUUID(),
            insert: [{ values: { [c]: "outside finished task" } }],
          }),
        ),
      ).rejects.toThrow("assigned task");
    });
    it("metadata and create retries reject changed task context", async () => {
      const table = await make();
      const bot =
        (await prisma.sokoBot.findFirst({ where: { userId, workspaceId } })) ??
        (await prisma.sokoBot.create({ data: { userId, workspaceId } }));
      const tasks = [];
      for (let i = 0; i < 2; i++)
        tasks.push(
          await prisma.task.create({
            data: {
              ownerId: userId,
              creatorUserId: userId,
              workspaceId,
              name: "Task",
              status: "RUNNING",
              assigneeSokoBotId: bot.id,
            },
          }),
        );
      const agent: TableActor = {
        ...actor,
        actorKind: "sokoBot",
        actorId: bot.id,
        taskId: tasks[0].id,
      };
      const body = tableMutationSchema.parse({
        key: randomUUID(),
        version: 1,
        title: "First",
      });
      const first = await mutateDataTable(agent, table.id, body);
      expect(await mutateDataTable(agent, table.id, body)).toEqual(first);
      await expect(
        mutateDataTable({ ...agent, taskId: tasks[1].id }, table.id, body),
      ).rejects.toThrow("Retry key");
      const create = createDataTableSchema.parse({
        key: randomUUID(),
        title: "Task table",
        columns: [{ name: "Name", type: "text" }],
      });
      const created = await createDataTable(agent, create);
      expect((await createDataTable(agent, create)).id).toBe(created.id);
      await expect(
        createDataTable({ ...agent, taskId: tasks[1].id }, create),
      ).rejects.toThrow("Retry key");
    });

    it("F1 HTTP: bot keys require assigned tasks on create, detail, list, query and writes", async () => {
      const { default: app } = await import("@/routes/v1/drive/tables");
      const { generateSokoBotApiKeyToken, hashApiKey } = await import(
        "@/lib/coworker-api-key"
      );
      const bot = await prisma.sokoBot.findFirstOrThrow({
        where: { userId, workspaceId },
      });
      const token = generateSokoBotApiKeyToken();
      await prisma.coworkerApiKey.create({
        data: {
          sokoBotId: bot.id,
          keyHash: await hashApiKey(token),
          keyStart: "review-only",
        },
      });
      const headers = {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      };
      const response = await app.request("/", {
        method: "POST",
        headers,
        body: JSON.stringify({
          key: randomUUID(),
          title: "No task context",
          ownerChat: true, // Untrusted JSON cannot claim in-process owner authority.
          columns: [{ name: "Column", type: "text" }],
        }),
      });
      expect(response.status, await response.clone().text()).toBe(403);
      const table = await make();
      const task = await prisma.task.create({
        data: {
          ownerId: userId,
          creatorUserId: userId,
          workspaceId,
          name: "Finished",
          status: "COMPLETED",
          assigneeSokoBotId: bot.id,
        },
      });
      const body = JSON.stringify({
        key: randomUUID(),
        insert: [{ values: {} }],
      });
      const denied = await app.request(`/${table.id}/rows`, {
        method: "POST",
        headers: { ...headers, "X-Table-Task-Id": task.id },
        body,
      });
      expect(denied.status).toBe(403);
      const allowed = await app.request(`/${table.id}/rows`, {
        method: "POST",
        headers,
        body,
      });
      expect(allowed.status, await allowed.clone().text()).toBe(403);
      for (const path of ["/", `/${table.id}`])
        expect((await app.request(path, { headers })).status).toBe(403);
      expect(
        (
          await app.request(`/${table.id}/query`, {
            method: "POST",
            headers,
            body: "{}",
          })
        ).status,
      ).toBe(403);
      await prisma.task.update({
        where: { id: task.id },
        data: { status: "RUNNING" },
      });
      expect(
        (
          await app.request(`/${table.id}/rows`, {
            method: "POST",
            headers: { ...headers, "X-Table-Task-Id": task.id },
            body,
          })
        ).status,
      ).toBe(200);
    });

    it("SECURITY: coworker assigned scope and terminal grants enforced through HTTP", async () => {
      const { default: app } = await import("@/routes/v1/drive/tables");
      const { generateCoworkerApiKeyToken, hashApiKey } = await import(
        "@/lib/coworker-api-key"
      );
      const vendor = await prisma.vendor.create({
        data: { name: "Review vendor", slug: randomUUID() },
      });
      const coworker = await prisma.coworker.create({
        data: {
          name: "Review coworker",
          slug: randomUUID(),
          vendorId: vendor.id,
        },
      });
      try {
        const token = generateCoworkerApiKeyToken();
        await prisma.coworkerApiKey.create({
          data: {
            coworkerId: coworker.id,
            keyHash: await hashApiKey(token),
            keyStart: "review-only",
          },
        });
        const table = await make(),
          c = table.columns[0].id;
        const first = await insert(table.id, { [c]: "Selected" });
        await insert(table.id, { [c]: "Not selected" });
        const task = await prisma.task.create({
          data: {
            ownerId: userId,
            creatorUserId: userId,
            workspaceId,
            name: "Scoped",
            status: "RUNNING",
            assigneeId: coworker.id,
          },
        });
        await prisma.tableTaskScope.create({
          data: {
            tableId: table.id,
            taskId: task.id,
            rowIds: [first.rows[0].id],
            columnIds: [c],
            createdBy: userId,
          },
        });
        const headers = {
          Authorization: `Bearer ${token}`,
          "X-Context-User-Id": userId,
          "Content-Type": "application/json",
        };
        const query = () =>
          app.request(`/${table.id}/query`, {
            method: "POST",
            headers: { ...headers, "X-Table-Task-Id": task.id },
            body: "{}",
          });
        const response = await query();
        expect(response.status, await response.clone().text()).toBe(200);
        expect((await response.json()).data).toHaveLength(1);
        const missing = await app.request(`/${table.id}/query`, {
          method: "POST",
          headers,
          body: "{}",
        });
        expect(missing.status).toBe(403);
        const foreign = await app.request(`/${randomUUID()}/query`, {
          method: "POST",
          headers: { ...headers, "X-Table-Task-Id": task.id },
          body: "{}",
        });
        expect(foreign.status).toBe(404);
        const grant = await prisma.vendorGrant.create({
          data: {
            vendorId: vendor.id,
            workspaceId,
            permission: "workspace",
            status: "REVOKED",
          },
        });
        const revoked = await query();
        expect(revoked.status).toBe(403);
        await prisma.vendorGrant.update({
          where: { id: grant.id },
          data: { status: "DENIED" },
        });
        expect((await query()).status).toBe(403);
      } finally {
        await prisma.task.deleteMany({
          where: { workspaceId, assigneeId: coworker.id },
        });
        await prisma.coworker.delete({ where: { id: coworker.id } });
        await prisma.vendor.delete({ where: { id: vendor.id } });
      }
    });
    it("CONCURRENCY: exactly one competing edit succeeds, and audit matches the winner", async () => {
      const table = await make(),
        c = table.columns[0].id,
        row = (await insert(table.id, { [c]: "before" })).rows[0];
      const results = await Promise.allSettled(
        ["one", "two"].map((value) =>
          batchTableRows(
            actor,
            table.id,
            tableBatchSchema.parse({
              key: randomUUID(),
              patch: [{ id: row.id, version: 1, values: { [c]: value } }],
            }),
          ),
        ),
      );
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const after = (await queryTableRows(actor, table.id, {})).rows[0];
      expect(after.version).toBe(2);
      expect(
        await prisma.tableChange.count({
          where: { rowId: row.id, columnId: c },
        }),
      ).toBe(1);
    });
    it("CAPACITY: valid maximum-width patch transaction completes or records exact failure", async () => {
      const table = await make(Array(100).fill("text"));
      const inserted = await batchTableRows(
        actor,
        table.id,
        tableBatchSchema.parse({
          key: randomUUID(),
          insert: Array.from({ length: 100 }, () => ({ values: {} })),
        }),
      );
      const body = tableBatchSchema.parse({
        key: randomUUID(),
        patch: inserted.rows.map((row) => ({
          id: row.id,
          version: 1,
          values: Object.fromEntries(table.columns.map((c) => [c.id, "v"])),
        })),
      });
      const start = Date.now();
      try {
        const result = await batchTableRows(actor, table.id, body);
        expect(result.rows).toHaveLength(100);
        expect(
          await prisma.tableChange.count({
            where: { batchId: result.batchId, columnId: { not: null } },
          }),
        ).toBe(10000);
        const patchMs = Date.now() - start;
        const undone = await undoTableBatch(actor, table.id, {
          key: randomUUID(),
          batchId: result.batchId,
        });
        expect(undone.rows).toHaveLength(100);
        expect(
          undone.rows.every((row) =>
            Object.values(row.values).every((value) => value === null),
          ),
        ).toBe(true);
        process.stdout.write(
          `MAX_WIDTH_PATCH_MS ${patchMs} UNDO_MS ${Date.now() - start - patchMs}\n`,
        );
      } catch (error) {
        expect(
          await prisma.tableRow.count({
            where: { tableId: table.id, version: { not: 1 } },
          }),
        ).toBe(0);
        expect(
          await prisma.tableChange.count({
            where: { tableId: table.id, columnId: { not: null } },
          }),
        ).toBe(0);
        process.stdout.write("MAX_WIDTH_PATCH_ROLLBACK_VERIFIED\n");
        process.stdout.write(
          `MAX_WIDTH_PATCH_ERROR_MS ${Date.now() - start} ${error instanceof Error ? error.message : String(error)}\n`,
        );
        throw error;
      }
    }, 20000);

    it("F8/F10: undo cannot resurrect values invalid under the current schema", async () => {
      const table = await make(),
        c = table.columns[0].id;
      const row = (await insert(table.id, { [c]: "old text" })).rows[0];
      const clear = await batchTableRows(
        actor,
        table.id,
        tableBatchSchema.parse({
          key: randomUUID(),
          patch: [{ id: row.id, version: 1, values: { [c]: null } }],
        }),
      );
      await mutateDataTable(
        actor,
        table.id,
        tableMutationSchema.parse({
          key: randomUUID(),
          version: 1,
          columns: [{ ...table.columns[0], type: "number" }],
        }),
      );
      await expect(
        undoTableBatch(actor, table.id, {
          key: randomUUID(),
          batchId: clear.batchId,
        }),
      ).rejects.toThrow();
      const current = (await queryTableRows(actor, table.id, {})).rows[0];
      expect(current.values[c]).toBeNull();
      expect(current.version).toBe(2);
    });
  },
);
