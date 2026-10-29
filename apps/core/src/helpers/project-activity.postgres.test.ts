import { randomUUID } from "node:crypto";
import { createPrismaClient } from "@sokosumi/database/client";
import { afterAll, describe, expect, it, vi } from "vitest";
import { resolveProjectReaderAccess } from "@/types/project";
import {
  encodeProjectActivityCursor,
  type ProjectActivityRow,
  projectActivityPageQuery,
} from "./project-activity";

vi.mock("@/helpers/vendor-grants", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/helpers/vendor-grants")>();
  return {
    ...actual,
    hasGrantedWorkspaceAccess: vi.fn().mockResolvedValue(true),
  };
});

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

const SCHEMA_STATEMENTS = [
  "CREATE TYPE \"TaskVisibility\" AS ENUM ('PUBLIC', 'PRIVATE')",
  "CREATE TYPE \"TaskStatus\" AS ENUM ('DRAFT', 'READY')",
  'CREATE TABLE project (id uuid PRIMARY KEY, "workspaceId" uuid, "createdAt" timestamp, "updatedAt" timestamp, "closedAt" timestamp)',
  'CREATE TABLE task (id text PRIMARY KEY, "projectId" uuid, "workspaceId" uuid, "createdAt" timestamp, "archivedAt" timestamp, visibility "TaskVisibility", status "TaskStatus", "ownerId" text, "assigneeId" text)',
  'CREATE TABLE "taskEvent" ("taskId" text, "createdAt" timestamp)',
  'CREATE TABLE "Job" (id text PRIMARY KEY, "projectId" uuid, "workspaceId" uuid, "createdAt" timestamp, "taskId" text)',
  'CREATE TABLE "jobEvent" ("jobId" text, "createdAt" timestamp)',
  'CREATE TABLE task_file ("taskId" text, "updatedAt" timestamp, status text, origin text, "fileUrl" text)',
  'CREATE TABLE project_event ("projectId" uuid, "createdAt" timestamp)',
  'CREATE TABLE coworker (id text, "vendorId" uuid)',
  'CREATE TABLE project_star ("userId" text, "projectId" uuid, "starredAt" timestamp)',
];

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
        for (const statement of SCHEMA_STATEMENTS)
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
        await tx.$executeRaw`INSERT INTO "Job" VALUES ('job',${id(7)}::uuid,${workspaceId}::uuid,'2026-01-01',NULL), ('secret-job',${id(3)}::uuid,${workspaceId}::uuid,'2031-01-01','secret')`;
        await tx.$executeRaw`INSERT INTO "Job" VALUES ('archived-created', ${id(4)}::uuid, ${workspaceId}::uuid, '2033-01-01', 'archived'), ('archived-event', ${id(4)}::uuid, ${workspaceId}::uuid, '2026-01-01', 'archived')`;
        await tx.$executeRaw`INSERT INTO "jobEvent" VALUES ('archived-event', '2034-01-01')`;
        await tx.$executeRaw`INSERT INTO "jobEvent" VALUES ('job','2026-04-01')`;
        await tx.$executeRaw`INSERT INTO project_event VALUES (${id(8)}::uuid,'2026-05-01'),(${id(26)}::uuid,'2032-01-01')`;
        const { sqlWhere: human } = await resolveProjectReaderAccess(
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
          return tx.$queryRaw<ProjectActivityRow[]>(
            projectActivityPageQuery({ workspaceId, cursor, take, visibility }),
          );
        }
        const first = await page(human);
        const second = await page(
          human,
          encodeProjectActivityCursor(workspaceId, first[first.length - 1]),
        );
        const third = await page(
          human,
          encodeProjectActivityCursor(workspaceId, second[second.length - 1]),
        );
        const ids = [...first, ...second, ...third].map((p) => p.id);
        expect(ids).toHaveLength(25);
        expect(new Set(ids).size).toBe(25);
        expect(ids.slice(0, 8)).toEqual([8, 7, 6, 2, 1, 5, 25, 24].map(id));
        expect(ids.slice(-2)).toEqual([4, 3].map(id));
        expect(ids).not.toContain(id(26));
        await expect(
          page(human, encodeProjectActivityCursor(otherWorkspace, first[0])),
        ).rejects.toThrow("Invalid project pagination cursor");
        await expect(page(human, "not-a-project")).rejects.toThrow(
          "Invalid project pagination cursor",
        );

        const anchor = first.at(-1);
        if (!anchor) throw new Error("Missing first-page anchor");
        await tx.$executeRaw`INSERT INTO project_event VALUES (${anchor.id}::uuid, '2035-01-01')`;
        expect(
          await page(human, encodeProjectActivityCursor(workspaceId, anchor)),
        ).toEqual(second);
        await tx.$executeRaw`DELETE FROM project WHERE id=${anchor.id}::uuid`;
        expect(
          await page(human, encodeProjectActivityCursor(workspaceId, anchor)),
        ).toEqual(second);

        const { sqlWhere: coworker } = await resolveProjectReaderAccess(
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
        const { sqlWhere: ungranted } = await resolveProjectReaderAccess(
          { actor: "coworker", coworkerId: "cow", vendorId },
          workspaceId,
        );
        expect(
          (await page(ungranted, undefined, 30)).slice(0, 4).map((p) => p.id),
        ).toEqual([8, 2, 25, 24].map(id));

        const { sqlWhere: otherReader } = await resolveProjectReaderAccess(
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
        await tx.$executeRaw`INSERT INTO "Job" VALUES ('new-job', ${id(10)}::uuid, ${workspaceId}::uuid, '2026-07-01', NULL)`;
        expect((await page(human)).slice(0, 3).map((p) => p.id)).toEqual(
          [10, 9, 8].map(id),
        );
        await tx.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
      },
      { timeout: 20000 },
    );
  });

  it("leads with the reader's Pins across pages and splits open from closed", async () => {
    if (!db) throw new Error("Missing integration database");
    await db.$transaction(
      async (tx) => {
        const schema = `activity_test_${randomUUID().replaceAll("-", "")}`;
        await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
        for (const statement of SCHEMA_STATEMENTS)
          await tx.$executeRawUnsafe(statement);
        // Creation is the only activity, so a higher n is a later project.
        for (let n = 1; n <= 6; n++) {
          await tx.$executeRaw`INSERT INTO project VALUES (${id(n)}::uuid, ${workspaceId}::uuid, ${new Date(Date.UTC(2026, 0, n))}, '2030-01-01', ${n === 6 ? new Date("2026-02-01") : null})`;
        }
        // 2 was Pinned before 4; 6 is Pinned but closed; another reader Pinned 5.
        await tx.$executeRaw`INSERT INTO project_star VALUES
          ('reader', ${id(4)}::uuid, '2026-03-02'), ('reader', ${id(2)}::uuid, '2026-03-01'),
          ('reader', ${id(6)}::uuid, '2026-03-03'), ('another', ${id(5)}::uuid, '2026-03-01')`;
        const { sqlWhere: visibility } = await resolveProjectReaderAccess(
          {
            actor: "user",
            userId: "reader",
            organizationId: null,
            role: "user",
          },
          workspaceId,
        );
        async function all(
          state: "open" | "closed" | undefined,
          pinnedFirstUserId: string | null,
        ) {
          const rows: ProjectActivityRow[] = [];
          let cursor: string | undefined;
          // One row per page, so every boundary — Pin to Pin, Pin to the
          // rest, and within the rest — goes through the cursor.
          for (;;) {
            const [row] = await tx.$queryRaw<ProjectActivityRow[]>(
              projectActivityPageQuery({
                workspaceId,
                cursor,
                take: 1,
                visibility,
                state,
                pinnedFirstUserId,
              }),
            );
            if (!row) return rows.map((r) => r.id);
            rows.push(row);
            cursor = encodeProjectActivityCursor(workspaceId, row);
          }
        }

        expect(await all("open", "reader")).toEqual([2, 4, 5, 3, 1].map(id));
        expect(await all("closed", "reader")).toEqual([id(6)]);
        expect(await all(undefined, null)).toEqual([6, 5, 4, 3, 2, 1].map(id));
        await tx.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
      },
      { timeout: 20000 },
    );
  });
});
