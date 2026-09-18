import { randomUUID } from "node:crypto";
import { createPrismaClient } from "@sokosumi/database/client";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  projectActivityPageQuery,
  projectActivityVisibility,
} from "./project-activity";

vi.mock("@/helpers/vendor-grants", () => ({
  hasGrantedWorkspaceAccess: vi.fn().mockResolvedValue(true),
}));

const url = process.env.DATABASE_URL;
const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  url?.startsWith("postgres");
const db = enabled && url ? createPrismaClient(url) : null;
afterAll(async () => {
  await db?.$disconnect();
});

const workspaceId = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const otherWorkspace = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
const vendorId = "cccccccc-cccc-4ccc-cccc-cccccccccccc";
function id(n: number) {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

// Opt-in real Postgres proof. An isolated, transactional schema models only
// columns consumed by the query; this is not an authenticated application test.
describe.skipIf(!enabled)("project activity SQL against PostgreSQL", () => {
  it("orders globally across pages, with stable ties, creation fallback and reader-visible activity only", async () => {
    if (!db) throw new Error("Missing integration database");
    await db.$transaction(
      async (tx) => {
        const schema = `activity_test_${randomUUID().replaceAll("-", "")}`;
        await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
        const statements = [
          "CREATE TYPE \"TaskVisibility\" AS ENUM ('PUBLIC', 'PRIVATE')",
          "CREATE TYPE \"TaskStatus\" AS ENUM ('DRAFT', 'READY')",
          'CREATE TABLE project (id uuid PRIMARY KEY, "workspaceId" uuid, "createdAt" timestamp, "updatedAt" timestamp, "closedAt" timestamp)',
          'CREATE TABLE task (id text PRIMARY KEY, "projectId" uuid, "workspaceId" uuid, "createdAt" timestamp, "archivedAt" timestamp, visibility "TaskVisibility", status "TaskStatus", "ownerId" text, "assigneeId" text)',
          'CREATE TABLE "taskEvent" ("taskId" text, "createdAt" timestamp)',
          'CREATE TABLE job (id text PRIMARY KEY, "projectId" uuid, "workspaceId" uuid, "createdAt" timestamp, "taskId" text)',
          'CREATE TABLE "jobEvent" ("jobId" text, "createdAt" timestamp)',
          'CREATE TABLE task_file ("taskId" text, "updatedAt" timestamp, status text, origin text, "fileUrl" text)',
          'CREATE TABLE project_event ("projectId" uuid, "createdAt" timestamp)',
          'CREATE TABLE coworker (id text, "vendorId" uuid)',
        ];
        for (const statement of statements)
          await tx.$executeRawUnsafe(statement);
        for (let n = 1; n <= 26; n++) {
          await tx.$executeRaw`INSERT INTO project VALUES (${id(n)}::uuid, ${n === 26 ? otherWorkspace : workspaceId}::uuid, '2026-01-01', '2030-01-01', NULL)`;
        }
        // No activity: creation, not metadata update. Closed projects stay listed.
        await tx.$executeRaw`UPDATE project SET "createdAt"='2026-01-02', "closedAt"='2026-01-03' WHERE id=${id(25)}::uuid`;
        await tx.$executeRaw`INSERT INTO coworker VALUES ('sibling', ${vendorId}::uuid)`;
        for (const [
          taskId,
          project,
          visibility,
          owner,
          archived,
          assignee,
          status,
        ] of [
          ["public", 1, "PUBLIC", "another", false, null, "READY"],
          ["mine", 2, "PRIVATE", "reader", false, "sibling", "READY"],
          ["secret", 3, "PRIVATE", "another", false, null, "READY"],
          ["archived", 4, "PUBLIC", "reader", true, null, "READY"],
          ["draft", 5, "PUBLIC", "reader", false, null, "DRAFT"],
          ["output", 6, "PUBLIC", "reader", false, null, "READY"],
        ] as const) {
          await tx.$executeRaw`INSERT INTO task VALUES (${taskId}, ${id(project)}::uuid, ${workspaceId}::uuid, '2026-01-01', ${archived ? new Date("2026-01-02") : null}, ${visibility}::"TaskVisibility", ${status}::"TaskStatus", ${owner}, ${assignee})`;
        }
        await tx.$executeRaw`INSERT INTO "taskEvent" VALUES ('public','2026-02-01'),('mine','2026-02-01'),('secret','2031-01-01'),('archived','2031-01-01'),('draft','2026-01-15')`;
        await tx.$executeRaw`INSERT INTO task_file VALUES ('output','2026-03-01','READY','TASK_OUTPUT','https://example.com/file'),('public','2031-01-01','PENDING','TASK_OUTPUT',NULL),('public','2031-01-01','READY','TASK_INPUT','https://example.com/input')`;
        await tx.$executeRaw`INSERT INTO job VALUES ('job',${id(7)}::uuid,${workspaceId}::uuid,'2026-01-01',NULL), ('secret-job',${id(3)}::uuid,${workspaceId}::uuid,'2031-01-01','secret')`;
        await tx.$executeRaw`INSERT INTO "jobEvent" VALUES ('job','2026-04-01')`;
        await tx.$executeRaw`INSERT INTO project_event VALUES (${id(8)}::uuid,'2026-05-01'),(${id(26)}::uuid,'2032-01-01')`;
        const human = await projectActivityVisibility(
          {
            actor: "user",
            userId: "reader",
            organizationId: null,
            role: "user",
          },
          workspaceId,
        );
        async function page(
          visibility: typeof human,
          cursor?: string,
          take = 10,
        ) {
          return tx.$queryRaw<Array<{ id: string }>>(
            projectActivityPageQuery({ workspaceId, cursor, take, visibility }),
          );
        }
        const first = await page(human);
        const second = await page(human, first.at(-1)?.id);
        const third = await page(human, second.at(-1)?.id);
        const ids = [...first, ...second, ...third].map((p) => p.id);
        expect(ids).toHaveLength(25);
        expect(new Set(ids).size).toBe(25);
        expect(ids.slice(0, 8)).toEqual([8, 7, 6, 2, 1, 5, 25, 24].map(id));
        expect(ids.slice(-2)).toEqual([4, 3].map(id));
        expect(ids).not.toContain(id(26));
        expect(await page(human, id(26))).toEqual([]);
        expect(await page(human, "not-a-project")).toEqual([]);

        const coworker = await projectActivityVisibility(
          {
            actor: "coworker",
            coworkerId: "cow",
            vendorId,
            context: { userId: "reader", organizationId: null },
          },
          workspaceId,
        );
        const coworkerIds = (await page(coworker, undefined, 30)).map(
          (p) => p.id,
        );
        // Grant sees public task events and same-vendor private tasks, not drafts,
        // another owner's private work or unassigned jobs.
        expect(coworkerIds.slice(0, 6)).toEqual([8, 6, 2, 1, 25, 24].map(id));
        const ungranted = await projectActivityVisibility(
          { actor: "coworker", coworkerId: "cow", vendorId },
          workspaceId,
        );
        expect(
          (await page(ungranted, undefined, 30)).slice(0, 4).map((p) => p.id),
        ).toEqual([8, 2, 25, 24].map(id));

        const otherReader = await projectActivityVisibility(
          {
            actor: "user",
            userId: "another",
            organizationId: null,
            role: "user",
          },
          workspaceId,
        );
        expect((await page(otherReader))[0]?.id).toBe(id(3));
        // Creation itself is work, even before the first event is recorded.
        await tx.$executeRaw`INSERT INTO task VALUES ('new-task', ${id(9)}::uuid, ${workspaceId}::uuid, '2026-06-01', NULL, 'PUBLIC', 'READY', 'reader', NULL)`;
        await tx.$executeRaw`INSERT INTO job VALUES ('new-job', ${id(10)}::uuid, ${workspaceId}::uuid, '2026-07-01', NULL)`;
        expect((await page(human)).slice(0, 3).map((p) => p.id)).toEqual(
          [10, 9, 8].map(id),
        );
        await tx.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
      },
      { timeout: 20000 },
    );
  });
});
