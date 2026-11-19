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
        'seo_audit(id uuid, "workspaceId" uuid, "deletedAt" timestamp, "archivedAt" timestamp)',
        'workspace(id uuid, "userId" text, "organizationId" text)',
        "organization(id text, slug text)",
        'project(id uuid, "workspaceId" uuid)',
        'task(id text, "assigneeId" text, status text, "updatedAt" timestamp)',
        '"taskEvent"("taskId" text, status text, "coworkerId" text, "createdAt" timestamp, id text, comment text, "userId" text, "sokoBotId" uuid, "transactionId" text, cents bigint)',
        '"Transaction"(id text, amount bigint)',
        'seo_connection("workspaceId" uuid, "userId" text, provider text, status text, id uuid DEFAULT gen_random_uuid(), "updatedAt" timestamp DEFAULT now())',
        'project_seo_observation(id uuid, "auditId" uuid, "projectId" uuid, "sourceTaskId" text, source text, kind text, "ownerId" text, payload jsonb, "pageIds" uuid[], "createdAt" timestamp)',
      ])
        await tx.$executeRawUnsafe(`CREATE TEMP TABLE ${ddl} ON COMMIT DROP`);
      const workspace = "00000000-0000-4000-8000-000000000001";
      await tx.$executeRaw`INSERT INTO workspace VALUES (${workspace}::uuid,NULL,'org')`;
      await tx.$executeRaw`INSERT INTO organization VALUES ('org','audit-ops')`;
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
      await tx.$executeRaw`INSERT INTO project_seo_observation VALUES(${id(54)}::uuid,${id(8)}::uuid,NULL,'10','seo_coworker','audit_full',NULL,'{"pageRunFailures":1,"specialistFailures":["seasonal","exploration","searchInvestigation"]}',ARRAY[${id(61)}::uuid,${id(62)}::uuid,${id(63)}::uuid,${id(64)}::uuid],timestamp '2026-10-10')`;
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
      ).toMatchObject({
        provider: "ga4",
        status: "NEEDS_RECONNECT",
        workspaceId: workspace,
        workspaceOrganizationSlug: "audit-ops",
      });
      expect(report.items[0]?.severity).toBe("critical");
      expect(report.items.find((row) => row.id === id(4))).toMatchObject({
        auditId: id(4),
        workspaceId: workspace,
        workspaceOrganizationSlug: "audit-ops",
      });
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
        reasons: [
          "pageException",
          "seasonalFailed",
          "explorationFailed",
          "investigationFailed",
        ],
        failedPages: 1,
        attemptedPages: 5,
      });
      expect(report.items.some((row) => row.id === id(9))).toBe(false);
      expect(JSON.stringify(report)).not.toMatch(
        /SECRET|example\.test|private-property|owner[0-9]/,
      );
      // A delayed worker start, paused Task or unrelated actor does not prove overdue execution.
      for (const [n, status, who, minutes] of [
        [20, "RUNNING", "worker", 121],
        [21, "RUNNING", "worker", 119],
        [22, "OUT_OF_CREDITS", "worker", 500],
        [23, "RUNNING", "other", 500],
        [24, "QUEUED", "worker", 500],
        [25, "INPUT_REQUIRED", "worker", 500],
      ] as const) {
        await tx.$executeRaw`INSERT INTO seo_audit VALUES (${id(n)}::uuid,${workspace}::uuid,NULL)`;
        await tx.$executeRaw`INSERT INTO project_seo_analysis VALUES (${id(200 + n)}::uuid,${id(n)}::uuid,NULL,'owner','{}','completed',NULL,'audit_full',timestamp '2026-01-01',timestamp '2026-01-01',NULL)`;
        await tx.$executeRaw`INSERT INTO project_seo_analysis VALUES (${id(250 + n)}::uuid,${id(n)}::uuid,NULL,'owner','{}','requested',${"active" + n},'audit_full',timestamp '2026-02-01',timestamp '2026-02-01',NULL)`;
        await tx.$executeRaw`INSERT INTO task VALUES (${"active" + n},'worker',${status},timezone('UTC',now()))`;
        await tx.$executeRaw`INSERT INTO "taskEvent" VALUES (${"active" + n},'RUNNING',${who},timezone('UTC',now())-make_interval(mins=>${minutes}::int),'running')`;
      }
      const overdue = (
        await listAdminSeoAlerts({ period: "30", page: 1 }, tx)
      ).items.filter((r) => r.reasons.includes("workerOverdue"));
      expect(overdue.map((r) => r.id)).toEqual([id(20)]);
      await tx.$executeRaw`INSERT INTO project_seo_observation VALUES(${id(87)}::uuid,${id(20)}::uuid,NULL,'active20','seo_coworker','audit_full',NULL,'{}',ARRAY[${id(81)}::uuid],timezone('UTC',now()))`;
      expect(
        (await listAdminSeoAlerts({ period: "all", page: 1 }, tx)).items.some(
          (r) => r.id === id(20),
        ),
      ).toBe(false);

      // The first metered run has no previous report. Only the assigned worker may signal pending receipts.
      const pending =
        "The audit finished. Its final price is pending while we verify the cost receipts. No credits have been charged.";
      const price = {
        kind: "cost_plus",
        version: 1,
        minimumCredits: 750,
        markupPercent: 50,
      };
      const fullAuditBillingContext = {
        ownerId: "owner",
        workspaceId: workspace,
        organizationId: null,
        projectId: null,
        coworkerId: "worker",
      };
      for (const n of [31, 32, 33, 34, 35]) {
        await tx.$executeRaw`INSERT INTO seo_audit VALUES (${id(n)}::uuid,${workspace}::uuid,NULL)`;
        await tx.$executeRaw`INSERT INTO project_seo_analysis VALUES (${id(300 + n)}::uuid,${id(n)}::uuid,NULL,'owner',${JSON.stringify(n === 35 ? {} : { price, fullAuditBillingContext })}::jsonb,'requested',${"metered" + n},'audit_full',timezone('UTC',now()),timezone('UTC',now()),NULL)`;
        await tx.$executeRaw`INSERT INTO task VALUES (${"metered" + n},'worker','RUNNING',timezone('UTC',now()))`;
      }
      for (const [n, coworker, user, text] of [
        [31, "worker", null, pending],
        [32, null, "user", pending],
        [33, "different", null, pending],
        [34, "worker", null, pending + " injected price"],
        [35, "worker", null, pending],
      ] as const) {
        await tx.$executeRaw`INSERT INTO "taskEvent" ("taskId","coworkerId","userId",comment,"createdAt",id) VALUES (${"metered" + n},${coworker},${user},${text},timezone('UTC',now()),'comment')`;
      }
      await tx.$executeRaw`UPDATE task SET "assigneeId"='different' WHERE id='metered33'`;
      const pricing = (
        await listAdminSeoAlerts({ period: "30", page: 1 }, tx)
      ).items.filter((r) =>
        r.reasons.some((reason) => reason === "priceReceiptPending"),
      );
      expect(pricing.map((r) => r.taskId)).toEqual(["metered31"]);
      const billing = async () =>
        listAdminSeoAlerts({ period: "30", page: 1, view: "billing" }, tx);
      const first = await billing();
      expect(first).toMatchObject({ billingTotal: 4, pricingAttention: 1 });
      expect(
        first.billing.find((row) => row.taskId === "metered31"),
      ).toMatchObject({
        status: "receiptsPending",
        approvedMaxCredits: null,
        cost: null,
        chargedCredits: null,
      });
      expect(
        first.billing.find((row) => row.taskId === "metered32")?.status,
      ).toBe("inProgress");
      const cost = {
        version: 1,
        gatewayMicroUsd: 1500000,
        directModelMicroUsd: 2200000,
        dataForSeoMicroUsd: 2299986,
        otherApiMicroUsd: 14,
      };
      await tx.$executeRaw`UPDATE project_seo_analysis SET request=request || jsonb_build_object('pendingFullAuditCost',${JSON.stringify(cost)}::jsonb,'limits','{"usd":2.299986}'::jsonb) WHERE "taskId"='metered31'`;
      const incident = async (taskId: string) =>
        (await listAdminSeoAlerts({ period: "30", page: 1 }, tx)).items.find(
          (row) => row.taskId === taskId,
        );
      await tx.$executeRaw`UPDATE task SET status='OUT_OF_CREDITS' WHERE id='metered31'`;
      await tx.$executeRaw`INSERT INTO "taskEvent" ("taskId",status,"coworkerId",cents,"createdAt",id) VALUES ('metered31','OUT_OF_CREDITS','worker',9000000000000,timezone('UTC',now()),'paused')`;
      expect(
        (await billing()).billing.find((row) => row.taskId === "metered31"),
      ).toMatchObject({
        status: "needsCredits",
        attemptedCredits: 900,
        chargedCredits: null,
        cost,
      });
      await tx.$executeRaw`UPDATE task SET status='CREDITS_TOPPED_UP' WHERE id='metered31'`;
      expect(
        (await billing()).billing.find((row) => row.taskId === "metered31"),
      ).toMatchObject({ status: "retrying", chargedCredits: null });
      await tx.$executeRaw`UPDATE task SET status='CANCELED' WHERE id='metered31'`;
      expect(
        (await billing()).billing.find((row) => row.taskId === "metered31"),
      ).toMatchObject({
        status: "abandoned",
        attemptedCredits: 900,
        chargedCredits: null,
        cost,
        dataBudgetUsd: 2.299986,
      });
      expect(await incident("metered31")).toMatchObject({
        severity: "warning",
        reasons: ["priceUnpaid"],
      });
      await tx.$executeRaw`UPDATE project_seo_analysis SET request=jsonb_set(request,'{limits,usd}','2.299985') WHERE "taskId"='metered31'`;
      expect((await incident("metered31"))?.reasons).toContain(
        "dataBudgetExceeded",
      );
      await tx.$executeRaw`UPDATE project_seo_analysis SET request=request - 'pendingFullAuditCost' - 'limits' WHERE "taskId"='metered31'`;
      await tx.$executeRaw`UPDATE project_seo_analysis SET request=request || jsonb_build_object('fullAuditCost',${JSON.stringify(cost)}::jsonb) WHERE "taskId" IN ('metered31','metered32')`;
      await tx.$executeRaw`UPDATE task SET status='COMPLETED' WHERE id IN ('metered31','metered32')`;
      await tx.$executeRaw`INSERT INTO "Transaction" VALUES ('real-debit',-9000000000000)`;
      await tx.$executeRaw`INSERT INTO "taskEvent" ("taskId",status,"coworkerId","transactionId",cents,"createdAt",id) VALUES ('metered31','COMPLETED','worker','real-debit',9000000000000,timezone('UTC',now()),'settled'),('metered32','COMPLETED','different',NULL,12000000000000,timezone('UTC',now()),'untrusted')`;
      const done = await billing();
      expect(done.pricingAttention).toBe(1);
      expect(await incident("metered32")).toMatchObject({
        severity: "critical",
        reasons: ["priceUnverified"],
      });
      expect(
        done.billing.find((row) => row.taskId === "metered31"),
      ).toMatchObject({ status: "settled", chargedCredits: 900, cost });
      expect(
        done.billing.find((row) => row.taskId === "metered32"),
      ).toMatchObject({
        status: "unverified",
        chargedCredits: null,
        cost: null,
      });
      await tx.$executeRaw`UPDATE task SET status='READY', "assigneeId"='replacement' WHERE id='metered31'`;
      expect(
        (await billing()).billing.find((row) => row.taskId === "metered31"),
      ).toMatchObject({ status: "settled", chargedCredits: 900, cost });
      // A valid-looking breakdown still has to explain the recorded debit under the approved terms.
      await tx.$executeRaw`UPDATE project_seo_analysis SET request=jsonb_set(request,'{fullAuditCost,gatewayMicroUsd}','1') WHERE "taskId"='metered31'`;
      expect(
        (await billing()).billing.find((row) => row.taskId === "metered31"),
      ).toMatchObject({
        status: "unverified",
        chargedCredits: 900,
        cost: null,
      });
      expect(JSON.stringify(done)).not.toMatch(
        /real-debit|injected|private-property|example\.test/,
      );
      expect(await incident("metered31")).toMatchObject({
        severity: "critical",
        reasons: ["priceUnverified"],
      });
      await tx.$executeRaw`UPDATE project_seo_analysis SET request=jsonb_set(request,'{fullAuditCost}',${JSON.stringify(cost)}::jsonb) WHERE "taskId"='metered31'`;
      await tx.$executeRaw`INSERT INTO "Transaction" VALUES ('duplicate-debit',-9000000000000)`;
      await tx.$executeRaw`INSERT INTO "taskEvent" ("taskId",status,"coworkerId","transactionId",cents,"createdAt",id) VALUES ('metered31','COMPLETED','worker','duplicate-debit',9000000000000,timezone('UTC',now()),'duplicate')`;
      expect(
        (await billing()).billing.find((row) => row.taskId === "metered31"),
      ).toMatchObject({
        status: "unverified",
        attemptedCredits: 900,
        chargedCredits: 1800,
        cost: null,
      });
      expect(await incident("metered31")).toMatchObject({
        severity: "critical",
        reasons: ["priceUnverified"],
      });
      // Billing anomalies stay attached to the original run when the next scheduled audit fails.
      await tx.$executeRaw`INSERT INTO project_seo_analysis VALUES (${id(931)}::uuid,${id(31)}::uuid,NULL,'owner','{}','failed','next31','audit_full',timezone('UTC',now())+interval '1 minute',timezone('UTC',now()),NULL)`;
      await tx.$executeRaw`INSERT INTO task VALUES ('next31','worker','FAILED',timezone('UTC',now()))`;
      await tx.$executeRaw`INSERT INTO "taskEvent" ("taskId",status,"coworkerId","createdAt",id) VALUES ('next31','FAILED','worker',timezone('UTC',now()),'failure')`;
      expect(await incident("next31")).toMatchObject({
        severity: "critical",
        reasons: ["workerFailed"],
      });
      expect(await incident("metered31")).toMatchObject({
        severity: "critical",
        reasons: ["priceUnverified"],
      });
      await tx.$executeRaw`DELETE FROM project_seo_analysis WHERE "taskId"='next31'`;
      // Close these temporary runs so the existing all-period historic assertions stay independent.
      await tx.$executeRaw`UPDATE seo_audit SET "archivedAt"=timezone('UTC',now()) WHERE id IN (${id(31)}::uuid,${id(32)}::uuid,${id(33)}::uuid,${id(34)}::uuid,${id(35)}::uuid)`;

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
      await tx.$executeRaw`UPDATE seo_audit SET "archivedAt"=timezone('UTC',now()) WHERE id=${id(11)}::uuid`;
      expect(
        (await listAdminSeoAlerts({ period: "all", page: 1 }, tx)).items.some(
          (row) => row.id === id(11),
        ),
      ).toBe(false);
      await tx.$executeRaw`UPDATE seo_audit SET "archivedAt"=NULL WHERE id=${id(11)}::uuid`;
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
