import { expect, it } from "vitest";
import prisma from "@/lib/db/prisma";
import { listAdminSeoAlerts } from "./admin-seo-alerts";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");
// Temp tables keep the all-workspace dashboard test independent of rows created by parallel suites.
it.skipIf(!enabled)(
  "deduplicates runs, counts only real page exceptions and distinguishes consent, evidence, and unknowns",
  async () => {
    await prisma.$transaction(async (tx) => {
      for (const ddl of [
        'project_seo_analysis(id uuid, "auditId" uuid, "projectId" uuid, "requestedBy" text, request jsonb, status text, "taskId" text, kind text, "createdAt" timestamp, "updatedAt" timestamp, "failureReason" text)',
        'seo_audit(id uuid, "workspaceId" uuid, "deletedAt" timestamp)',
        'project(id uuid, "workspaceId" uuid)',
        'task(id text, "assigneeId" text, status text, "updatedAt" timestamp)',
        '"taskEvent"("taskId" text, status text, "coworkerId" text, "createdAt" timestamp, id text)',
        'seo_connection("workspaceId" uuid, "userId" text, provider text, status text, id uuid DEFAULT gen_random_uuid(), "updatedAt" timestamp DEFAULT now())',
        'project_seo_observation(id uuid, "auditId" uuid, "projectId" uuid, "sourceTaskId" text, source text, kind text, "ownerId" text, payload jsonb, "pageIds" uuid[], "createdAt" timestamp)',
      ])
        await tx.$executeRawUnsafe(`CREATE TEMP TABLE ${ddl} ON COMMIT DROP`);
      const workspace = "00000000-0000-4000-8000-000000000001";
      const id = (n: number) =>
        `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
      // 1 has an older failure followed by a successful result. 6 also recovered, without alerts.
      for (const [run, audit, status, request] of [
        [1, 1, "failed", {}],
        [
          2,
          1,
          "completed",
          {
            pageUrls: [
              "https://example.test/a",
              "https://example.test/b",
              "https://example.test/c",
            ],
          },
        ],
        [3, 2, "completed", { searchConsoleAccess: null }],
        [4, 3, "completed", {}],
        [
          5,
          4,
          "completed",
          { searchConsoleAccess: { propertyId: "private-property" } },
        ],
        [6, 5, "dispatched", {}],
        [7, 6, "failed", {}],
        [8, 6, "completed", {}],
        [9, 7, "completed", {}],
        [10, 8, "completed", {}],
        [12, 10, "failed", {}],
        [11, 9, "completed", { pageUrls: ["https://example.test/only"] }],
      ] as const) {
        const user = `owner${audit}`;
        await tx.$executeRaw`INSERT INTO project_seo_analysis VALUES(${id(run + 20)}::uuid,${id(audit)}::uuid,NULL,${user},${JSON.stringify(request)}::jsonb,${status},${String(run)},'audit_full',timestamp '2026-10-01'+make_interval(days=>${run}::int),timestamp '2026-10-01'+make_interval(days=>${run}::int))`;
      }
      for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
        await tx.$executeRaw`INSERT INTO seo_audit VALUES (${id(n)}::uuid,${workspace}::uuid,NULL)`;
      await tx.$executeRaw`INSERT INTO task VALUES ('6','worker','FAILED',timestamp '2026-10-07')`;
      await tx.$executeRaw`INSERT INTO "taskEvent" VALUES ('6','FAILED','worker',timezone('UTC',now()),'event')`;
      const payload = {
        pageUrls: ["https://example.test/a"],
        notes: [
          "Page not audited: https://example.test/b (the page Run failed: stack SECRET)",
          "Page not audited: https://example.test/b (the page Run failed: duplicate)",
          "Page not audited: https://example.test/c (budget exhausted)",
          "Page not audited: https://unapproved.test/ (the page Run failed: fabricated)",
        ],
      };
      await tx.$executeRaw`INSERT INTO project_seo_observation VALUES(${id(50)}::uuid,${id(1)}::uuid,NULL,'2','seo_coworker','audit_full',NULL,${JSON.stringify(payload)}::jsonb,ARRAY[${id(51)}::uuid],timestamp '2026-10-02')`;
      // Google returned unknown on every URL; this is not a disconnection.
      await tx.$executeRaw`INSERT INTO project_seo_observation VALUES(${id(52)}::uuid,${id(3)}::uuid,NULL,'4','search_console','index_inspection','owner3','{"providerAnsweredAll":true,"receipt":{"status":"unavailable"}}',NULL,timestamp '2026-10-04')`;
      await tx.$executeRaw`INSERT INTO project_seo_observation VALUES(${id(53)}::uuid,${id(7)}::uuid,NULL,'9','search_console','index_inspection','owner7','{"receipt":{"status":"not_connected"}}',NULL,timestamp '2026-10-09')`;
      await tx.$executeRaw`INSERT INTO project_seo_observation VALUES(${id(54)}::uuid,${id(8)}::uuid,NULL,'10','seo_coworker','audit_full',NULL,'{"pageRunFailures":1}',ARRAY[${id(61)}::uuid,${id(62)}::uuid,${id(63)}::uuid,${id(64)}::uuid],timestamp '2026-10-10')`;
      await tx.$executeRaw`INSERT INTO project_seo_observation VALUES(${id(55)}::uuid,${id(9)}::uuid,NULL,'11','seo_coworker','audit_full',NULL,'{"pageRunFailures":0,"notes":["Page not audited: https://example.test/only (the page Run failed: forged)"]}',ARRAY[${id(65)}::uuid],timestamp '2026-10-11')`;
      await tx.$executeRaw`UPDATE project_seo_analysis SET "failureReason"='The source report or its current authority could not be validated' WHERE "taskId"='12'`;
      await tx.$executeRaw`INSERT INTO project_seo_observation VALUES(${id(56)}::uuid,${id(4)}::uuid,NULL,'5','search_console','index_inspection','owner4','{"receipt":{"status":"needs_property"}}',NULL,timestamp '2026-10-05')`;
      const beforeDisconnect = await listAdminSeoAlerts(
        { period: "all", page: 1 },
        tx,
      );
      await tx.$executeRaw`INSERT INTO seo_connection ("workspaceId","userId",provider,status) VALUES (${workspace}::uuid,'owner2','search_console','NEEDS_RECONNECT'),(${workspace}::uuid,'owner4','search_console','NEEDS_RECONNECT'),(${workspace}::uuid,'owner4','ga4','DISCONNECTED'),(${workspace}::uuid,'owner6','ga4','NEEDS_RECONNECT'),(${workspace}::uuid,'unrelated','ga4','NEEDS_RECONNECT')`;
      const report = await listAdminSeoAlerts({ period: "all", page: 1 }, tx);
      expect(report).toMatchObject({
        total: 7,
        critical: 2,
        warning: 4,
        info: 1,
      });
      expect(report.items.find((row) => row.id === id(10))?.reasons).toEqual([
        "reportRejected",
      ]);
      expect(report.items).toEqual(beforeDisconnect.items);
      const connections = await listAdminSeoAlerts(
        { period: "all", page: 1, view: "connections" },
        tx,
      );
      expect(connections).toMatchObject({
        connectionTotal: 4,
        reconnect: 3,
        items: [],
      });
      expect(connections.connections).toHaveLength(4);
      expect(
        connections.connections.find((row) => row.userId === "owner6"),
      ).toMatchObject({ provider: "ga4", status: "NEEDS_RECONNECT" });
      expect(report.items[0]?.severity).toBe("critical");
      expect(report.items.find((row) => row.id === id(1))).toMatchObject({
        reasons: ["pageException", "pageFailureRate"],
        failedPages: 1,
        attemptedPages: 2,
      });
      expect(report.items.find((row) => row.id === id(2))?.reasons).toEqual([
        "gscSkipped",
      ]);
      expect(report.items.find((row) => row.id === id(4))?.reasons).toEqual([
        "gscProperty",
      ]);
      expect(report.items.find((row) => row.id === id(5))?.reasons).toEqual([
        "workerFailed",
      ]);
      expect(report.items.find((row) => row.id === id(7))?.reasons).toEqual([
        "gscDisconnected",
      ]);
      expect(report.items.find((row) => row.id === id(8))).toMatchObject({
        reasons: ["pageException"],
        failedPages: 1,
        attemptedPages: 5,
      });
      expect(report.items.some((row) => row.id === id(9))).toBe(false);
      expect(JSON.stringify(report)).not.toMatch(
        /SECRET|example\.test|private-property|owner[0-9]/,
      );
      // A later edit to a completed Task does not reset the grace period. A late import clears the incident.
      for (const [n, minutes] of [
        [11, 16],
        [12, 2],
      ]) {
        await tx.$executeRaw`INSERT INTO seo_audit VALUES (${id(n)}::uuid,${workspace}::uuid,NULL)`;
        await tx.$executeRaw`INSERT INTO project_seo_analysis VALUES (${id(100 + n)}::uuid,${id(n)}::uuid,NULL,'late-owner','{}','requested',${"late" + n},'audit_full',timezone('UTC',now()),timezone('UTC',now()),NULL)`;
        await tx.$executeRaw`INSERT INTO task VALUES (${"late" + n},'worker','COMPLETED',timezone('UTC',now()))`;
        await tx.$executeRaw`INSERT INTO "taskEvent" VALUES (${"late" + n},'COMPLETED','worker',timezone('UTC',now())-make_interval(mins=>${minutes}::int),'complete')`;
      }
      const late = await listAdminSeoAlerts({ period: "all", page: 1 }, tx);
      expect(late.items.find((row) => row.id === id(11))?.reasons).toEqual([
        "reportMissing",
      ]);
      expect(late.items.some((row) => row.id === id(12))).toBe(false);
      await tx.$executeRaw`INSERT INTO project_seo_observation VALUES(${id(80)}::uuid,${id(11)}::uuid,NULL,'late11','seo_coworker','audit_full',NULL,'{}',ARRAY[${id(81)}::uuid],timezone('UTC',now()))`;
      await tx.$executeRaw`UPDATE project_seo_analysis SET status='completed' WHERE "taskId"='late11'`;
      expect(
        (await listAdminSeoAlerts({ period: "all", page: 1 }, tx)).items.some(
          (row) => row.id === id(11),
        ),
      ).toBe(false);
      expect(
        (await listAdminSeoAlerts({ period: "all", page: 2 }, tx)).items,
      ).toEqual([]);
      expect(
        await listAdminSeoAlerts(
          { period: "all", page: 1, view: "counts" },
          tx,
        ),
      ).toMatchObject({ total: 7, critical: 2, warning: 4, items: [] });
    });
  },
);
