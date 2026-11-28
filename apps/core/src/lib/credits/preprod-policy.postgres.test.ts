/**
 * Preprod costs no credits (the user, 2026-11-26), on a real PostgreSQL with
 * all three schemas and Preprod on: the module's seam for the three payers
 * that run on Preprod, the grant's refusal, and Core's HTTP routes for the
 * credits payload, the ledger and the admin grant. Runs on the split layout
 * only: on today's layout Preprod's schema is Mainnet's.
 * SPLIT_LAYOUT_RUN=must-pass RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=… DATABASE_SCHEMA_*=… pnpm --filter core test src/lib/credits/preprod-policy.postgres.test.ts
 */
import "@hono/zod-openapi";

import { randomUUID } from "node:crypto";
import { convertCentsToCredits } from "@sokosumi/utils";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { NetworkScope } from "@/lib/db/network-scope";
import { onSplitLayout } from "@/test/split-layout";

import type { SpendInput, SpendResult } from "./spend";

// Before any import reads the environment: Preprod is on in this run only.
await vi.hoisted(async () => {
  const { isSplitLayout } = await import("@/test/split-layout-pending");
  vi.stubEnv(
    "NETWORK_PREPROD_ENABLED",
    isSplitLayout(process.env) ? "true" : "false",
  );
});
// The real grant, recorded: the admin route's write cannot run on the split
// layout yet (it reaches `credit_bucket` through the shared client; ticket 27's
// lines in `split-layout-pending.txt`), so its case answers for the write.
vi.mock("./grant", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./grant")>();
  return { ...actual, grant: vi.fn(actual.grant) };
});
vi.mock("@/helpers/background-email", () => ({
  sendEmailInBackground: vi.fn(),
}));
vi.mock("@/clients/stripe.client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/clients/stripe.client")>();
  return {
    ...actual,
    stripeClient: {
      ...actual.stripeClient,
      createUserCustomer: vi.fn().mockResolvedValue({}),
    },
  };
});
vi.mock("@/services/webhook.service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/webhook.service")>();
  return {
    ...actual,
    webhookService: {
      ...actual.webhookService,
      callAccountCreated: vi.fn().mockResolvedValue(undefined),
      callUserWebhook: vi.fn().mockResolvedValue(undefined),
    },
  };
});

const onPostgres =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  Boolean(process.env.DATABASE_URL?.startsWith("postgres"));
const enabled = onPostgres && onSplitLayout;

/** Module loads and sign-ins, past Vitest's 10 s hook limit on CI's runner. */
const SETUP_TIMEOUT = 120_000;
/** Several transactions and requests on a loaded machine. */
const CASE_TIMEOUT = 60_000;
const CREDIT = 10n ** 10n;
const HEADER = "X-Sokosumi-Network";

describe.runIf(enabled)(
  "Preprod costs no credits (PostgreSQL, split layout)",
  () => {
    let spend: typeof import("./spend").spend;
    let grant: typeof import("./grant").grant;
    let network: typeof import("@/lib/db/network-scope");
    let prisma: typeof import("@/lib/db/prisma").default;
    let fixture: typeof import("@/test-fixtures/core-session");
    let createPersonalWorkspace: typeof import("@/helpers/personal-workspace").createPersonalWorkspace;
    let app: ReturnType<
      typeof import("@/test-fixtures/core-session").createCoreApp
    >;
    const userIds: string[] = [];

    beforeAll(async () => {
      ({ spend } = await import("./spend"));
      ({ grant } = await import("./grant"));
      network = await import("@/lib/db/network-scope");
      ({ default: prisma } = await import("@/lib/db/prisma"));
      fixture = await import("@/test-fixtures/core-session");
      ({ createPersonalWorkspace } = await import(
        "@/helpers/personal-workspace"
      ));
      app = fixture.createCoreApp();
    }, SETUP_TIMEOUT);

    afterAll(async () => {
      for (const name of ["mainnet", "preprod"] as const) {
        const db = network.createNetworkScope(name).networkDb;
        const billed = { userId: { in: userIds } };
        await db.creditConsumption.deleteMany({
          where: { transaction: billed },
        });
        await db.creditBucket.deleteMany({ where: billed });
        await db.transaction.deleteMany({ where: billed });
      }
      vi.unstubAllEnvs();
    }, SETUP_TIMEOUT);

    const mainnet = (): NetworkScope => network.createNetworkScope("mainnet");
    const preprod = (): NetworkScope => network.createNetworkScope("preprod");
    /** `spend` for a mode chosen at run time, as `describe.each` hands it. */
    const spendAny = (input: SpendInput) =>
      (spend as (input: SpendInput) => Promise<SpendResult>)(input);

    async function person() {
      const userId = randomUUID();
      await prisma.user.create({
        data: {
          id: userId,
          name: "Preprod policy fixture",
          email: `${userId}@example.test`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      userIds.push(userId);
      return { userId, organizationId: null, projectId: null };
    }

    /** Every credit row of a user on one Network. */
    async function rows(scope: NetworkScope, userId: string) {
      const db = scope.networkDb;
      const [transactions, buckets, consumptions] = await Promise.all([
        db.transaction.findMany({
          where: { userId },
          select: { id: true, amount: true },
          orderBy: { amount: "asc" },
        }),
        db.creditBucket.count({ where: { userId } }),
        db.creditConsumption.count({ where: { transaction: { userId } } }),
      ]);
      return { transactions, buckets, consumptions };
    }

    async function fund(userId: string, cents: bigint) {
      await mainnet().networkDb.transaction.create({
        data: {
          amount: cents,
          userId,
          sourceCreditBucket: { create: { amount: cents, userId } },
        },
      });
    }

    describe.each([
      ["job_hire", "in_full"],
      ["task_credits", "in_full"],
      ["coworker_usage", "in_full_or_zero"],
    ] as const)("%s", (kind, mode) => {
      it(
        "records its price on Preprod, takes nothing and writes nothing on Mainnet",
        async () => {
          const payer = await person();
          const scope = preprod();

          const spent = await scope.sharedTransaction(
            (tx) =>
              spendAny({
                scope,
                tx,
                kind,
                payer,
                quotedCents: 3n * CREDIT,
                mode,
              }),
            "conflict",
            "Serializable",
          );

          expect(spent).toMatchObject({
            outcome: "recorded_not_charged",
            quotedCents: 3n * CREDIT,
            chargedCents: 0n,
            shortfall: false,
          });
          expect(await rows(preprod(), payer.userId)).toEqual({
            transactions: [{ id: spent.transactionId, amount: -3n * CREDIT }],
            buckets: 0,
            consumptions: 0,
          });
          expect(await rows(mainnet(), payer.userId)).toEqual({
            transactions: [],
            buckets: 0,
            consumptions: 0,
          });
        },
        CASE_TIMEOUT,
      );

      it(
        "charges the same call on Mainnet as before",
        async () => {
          const payer = await person();
          await fund(payer.userId, 5n * CREDIT);
          const scope = mainnet();

          const spent = await scope.sharedTransaction(
            (tx) =>
              spendAny({
                scope,
                tx,
                kind,
                payer,
                quotedCents: 3n * CREDIT,
                mode,
              }),
            "conflict",
            "Serializable",
          );

          expect(spent).toMatchObject({
            outcome: "charged",
            chargedCents: 3n * CREDIT,
          });
          expect(await rows(mainnet(), payer.userId)).toMatchObject({
            transactions: [
              { id: spent.transactionId, amount: -3n * CREDIT },
              { amount: 5n * CREDIT },
            ],
            buckets: 1,
            consumptions: 1,
          });
          expect(await rows(preprod(), payer.userId)).toEqual({
            transactions: [],
            buckets: 0,
            consumptions: 0,
          });
        },
        CASE_TIMEOUT,
      );
    });

    it(
      "refuses a Mainnet-only payer and a grant on Preprod, writing nothing",
      async () => {
        const payer = await person();
        const scope = preprod();

        const refusedSpend = await scope
          .sharedTransaction(
            (tx) =>
              spend({
                scope,
                tx,
                kind: "seo_chat",
                payer,
                quotedCents: CREDIT,
                mode: "in_full",
              }),
            "conflict",
          )
          .catch((error: unknown) => error);
        const refusedGrant = await prisma
          .$transaction((tx) =>
            grant({
              scope,
              tx,
              kind: "signup_bonus",
              userId: payer.userId,
              credits: 10,
              expiresAt: null,
              wakeTasks: true,
            }),
          )
          .catch((error: unknown) => error);

        expect(refusedSpend).toMatchObject({
          message:
            "seo_chat spends Mainnet credits only, and was given the preprod scope, which charges no credits",
        });
        expect(refusedGrant).toMatchObject({
          message:
            "A credit grant is Mainnet's only: preprod charges no credits, so it has none",
        });
        for (const scopeOf of [mainnet, preprod]) {
          expect(await rows(scopeOf(), payer.userId)).toEqual({
            transactions: [],
            buckets: 0,
            consumptions: 0,
          });
        }
      },
      CASE_TIMEOUT,
    );

    describe("Core's HTTP routes", () => {
      let admin: { id: string; email: string };
      let cookie: string;
      let mainnetSpend: string;
      let preprodSpend: string;

      beforeAll(async () => {
        // A platform admin has Preprod access, so the header gives Preprod.
        admin = await fixture.createPasswordUser(
          "Preprod policy admin",
          "admin",
        );
        userIds.push(admin.id);
        await createPersonalWorkspace(admin.id);
        cookie = await fixture.signIn(app, admin.email);
        const payer = {
          userId: admin.id,
          organizationId: null,
          projectId: null,
        };
        await fund(admin.id, 10n * CREDIT);
        const charge = (scope: NetworkScope, cents: bigint) =>
          scope.sharedTransaction(
            (tx) =>
              spend({
                scope,
                tx,
                kind: "task_credits",
                payer,
                quotedCents: cents,
                mode: "in_full",
              }),
            "conflict",
            "Serializable",
          );
        mainnetSpend =
          (await charge(mainnet(), 2n * CREDIT)).transactionId ?? "";
        preprodSpend =
          (await charge(preprod(), 7n * CREDIT)).transactionId ?? "";
      }, SETUP_TIMEOUT);

      async function get(path: string, preprodHeader: boolean) {
        return app.request(`${fixture.ORIGIN}/v1${path}`, {
          headers: {
            cookie,
            origin: fixture.ORIGIN,
            ...(preprodHeader && { [HEADER]: "preprod" }),
          },
        });
      }

      async function data(path: string, preprodHeader: boolean) {
        const response = await get(path, preprodHeader);
        expect(response.status).toBe(200);
        return ((await response.json()) as { data: unknown }).data;
      }

      it(
        "answers the credits payload with no balance and no plan on Preprod, and Mainnet's as before",
        async () => {
          const onPreprod = await data("/users/me/credits", true);
          const onMainnet = (await data("/users/me/credits", false)) as {
            spendable: number;
          };

          expect(onPreprod).toEqual({
            scope: "personal",
            spendable: 0,
            subscription: null,
            extra: {
              credits: { total: 0, remaining: 0, used: 0 },
              buckets: [],
              enterprise: null,
            },
            enterprise: null,
            credits: { subscription: null, buffer: 0, total: 0 },
          });
          // The fixture's 10 credits less the Mainnet spend; the 7 took nothing.
          expect(onMainnet.spendable).toBe(8);
        },
        CASE_TIMEOUT,
      );

      it(
        "keeps each Network's ledger, total and CSV to its own rows",
        async () => {
          const preprodPage = (await data("/transactions", true)) as {
            id: string;
            credits: number;
          }[];
          const mainnetPage = (await data("/transactions", false)) as {
            id: string;
          }[];
          const preprodTotal = await data("/transactions/total", true);
          const mainnetTotal = await data("/transactions/total", false);
          const csv = async (preprodHeader: boolean) => {
            const response = await get("/transactions/export", preprodHeader);
            expect(response.status).toBe(200);
            return response.text();
          };
          const [preprodCsv, mainnetCsv] = [await csv(true), await csv(false)];

          // A Preprod entry carries its price.
          expect(preprodPage).toEqual([
            expect.objectContaining({
              id: preprodSpend,
              credits: convertCentsToCredits(7n * CREDIT),
            }),
          ]);
          expect(preprodTotal).toEqual({ credits: 7, count: 1 });
          expect(mainnetPage.map(({ id }) => id)).toEqual([
            mainnetSpend,
            expect.any(String),
          ]);
          // Mainnet's net: the 2 spent less the 10 topped up; never the 7.
          expect(mainnetTotal).toEqual({ credits: -8, count: 2 });
          // Each line without its date: one Network's rows and totals only.
          const lines = (text: string) =>
            text
              .trimEnd()
              .split("\r\n")
              .map((line) => line.slice(line.indexOf(",") + 1));
          expect(lines(preprodCsv)).toEqual([
            "source,label,credits",
            "unattributed,Credit consumption,-7",
            "total,Spent,-7",
            "total,Top ups,0",
            "total,Net,-7",
          ]);
          expect(lines(mainnetCsv)).toEqual([
            "source,label,credits",
            "unattributed,Credit consumption,-2",
            "topUp,Top up,10",
            "total,Spent,-2",
            "total,Top ups,10",
            "total,Net,8",
          ]);
        },
        CASE_TIMEOUT,
      );

      it(
        "hands the admin grant the Mainnet scope under a Preprod header (the write itself waits for ticket 27's grant conversion on this layout)",
        async () => {
          const target = await person();
          const granted: string[] = [];
          vi.mocked(grant).mockImplementationOnce(async (input) => {
            granted.push(input.scope.network);
            return { outcome: "granted", bucketId: randomUUID() } as never;
          });

          const response = await app.request(
            `${fixture.ORIGIN}/v1/admin/credits`,
            {
              method: "POST",
              headers: {
                cookie,
                origin: fixture.ORIGIN,
                "content-type": "application/json",
                [HEADER]: "preprod",
              },
              body: JSON.stringify({
                targetType: "user",
                targetId: target.userId,
                credits: 5,
                ttlDays: 30,
                referenceNote: "Preprod policy fixture",
              }),
            },
          );

          expect(response.status).toBe(200);
          expect(granted).toEqual(["mainnet"]);
          expect(await rows(preprod(), target.userId)).toEqual({
            transactions: [],
            buckets: 0,
            consumptions: 0,
          });
        },
        CASE_TIMEOUT,
      );
    });

    describe("Core's HTTP routes, one id on both Networks", () => {
      let cookie: string;
      let taskId: string;
      const sharedId = randomUUID();
      const comment = `Mainnet-only comment ${randomUUID()}`;

      beforeAll(async () => {
        const owner = await fixture.createPasswordUser(
          "Equal ids admin",
          "admin",
        );
        userIds.push(owner.id);
        const workspace = await createPersonalWorkspace(owner.id);
        cookie = await fixture.signIn(app, owner.email);
        ({ id: taskId } = await prisma.task.create({
          data: {
            ownerId: owner.id,
            creatorUserId: owner.id,
            workspaceId: workspace.id,
            name: "Mainnet's Task",
            status: "RUNNING",
          },
          select: { id: true },
        }));
        // The same transaction id on both Networks, with different amounts;
        // the Task event that charged it is Mainnet's.
        await mainnet().networkDb.transaction.create({
          data: { id: sharedId, amount: -3n * CREDIT, userId: owner.id },
        });
        await preprod().networkDb.transaction.create({
          data: { id: sharedId, amount: -4n * CREDIT, userId: owner.id },
        });
        await prisma.taskEvent.create({
          data: {
            taskId,
            transactionId: sharedId,
            network: "mainnet",
            cents: 3n * CREDIT,
            comment,
          },
        });
      }, SETUP_TIMEOUT);

      async function data(path: string, onPreprod: boolean) {
        const response = await app.request(`${fixture.ORIGIN}/v1${path}`, {
          headers: {
            cookie,
            origin: fixture.ORIGIN,
            ...(onPreprod && { [HEADER]: "preprod" }),
          },
        });
        expect(response.status).toBe(200);
        return path.startsWith("/transactions/export")
          ? response.text()
          : ((await response.json()) as { data: unknown }).data;
      }

      const daySum = (series: unknown) =>
        (series as { credits: number }[]).reduce(
          (sum, { credits }) => sum + credits,
          0,
        );

      it(
        "never lends Preprod's row the Mainnet Task, its comment or its filter",
        async () => {
          const byTask = `taskId=${taskId}`;
          const byComment = `q=${encodeURIComponent(comment)}`;

          expect(await data("/transactions", true)).toEqual([
            expect.objectContaining({
              id: sharedId,
              kind: "unattributed",
              credits: 4,
            }),
          ]);
          for (const filter of [byTask, byComment]) {
            expect(await data(`/transactions?${filter}`, true)).toEqual([]);
            expect(await data(`/transactions/total?${filter}`, true)).toEqual({
              credits: 0,
              count: 0,
            });
            expect(
              daySum(await data(`/transactions/daily?${filter}`, true)),
            ).toBe(0);
            const csv = (await data(
              `/transactions/export?${filter}`,
              true,
            )) as string;
            expect(csv.trimEnd().split("\r\n")).toEqual([
              "date,source,label,credits",
              ",total,Spent,0",
              ",total,Top ups,0",
              ",total,Net,0",
            ]);
          }
        },
        CASE_TIMEOUT,
      );

      it(
        "keeps Mainnet's row its own: the Task, the comment and Mainnet's amount",
        async () => {
          for (const filter of [
            `taskId=${taskId}`,
            `q=${encodeURIComponent(comment)}`,
          ]) {
            expect(await data(`/transactions?${filter}`, false)).toEqual([
              expect.objectContaining({
                id: sharedId,
                kind: "task",
                taskId,
                credits: 3,
              }),
            ]);
            expect(await data(`/transactions/total?${filter}`, false)).toEqual({
              credits: 3,
              count: 1,
            });
            expect(
              daySum(await data(`/transactions/daily?${filter}`, false)),
            ).toBe(3);
          }
        },
        CASE_TIMEOUT,
      );
    });

    describe("a Preprod request that is refused", () => {
      let cookie: string;

      beforeAll(async () => {
        // No Preprod access: neither admin nor flagged.
        const user = await fixture.createPasswordUser("Refused person");
        userIds.push(user.id);
        await createPersonalWorkspace(user.id);
        await fund(user.id, 9n * CREDIT);
        cookie = await fixture.signIn(app, user.email);
      }, SETUP_TIMEOUT);

      const request = async (path: string, onPreprod: boolean) =>
        await app.request(`${fixture.ORIGIN}/v1${path}`, {
          headers: {
            cookie,
            origin: fixture.ORIGIN,
            ...(onPreprod && { [HEADER]: "preprod" }),
          },
        });

      /**
       * Runs `work` while another connection holds Mainnet's credit tables
       * and the plans locked against any read: PostgreSQL decides whether
       * the work reads them, because a read would wait for the lock.
       */
      async function whileCreditsLocked<T>(work: () => Promise<T>) {
        const locker = new Client({
          connectionString: process.env.DATABASE_URL,
        });
        await locker.connect();
        try {
          await locker.query("BEGIN");
          await locker.query(
            'LOCK TABLE mainnet."Transaction", mainnet."credit_bucket", mainnet."credit_consumption", shared."subscription" IN ACCESS EXCLUSIVE MODE',
          );
          return await work();
        } finally {
          await locker.query("ROLLBACK");
          await locker.end();
        }
      }

      const within = <T>(work: Promise<T>, ms: number) =>
        Promise.race([
          work,
          new Promise<"waited">((settle) =>
            setTimeout(() => settle("waited"), ms),
          ),
        ]);

      it(
        "answers its 403 without reading Mainnet's wallet, and with no Mainnet figure",
        async () => {
          const paths = [
            "/users/me/credits",
            "/transactions",
            "/transactions/total",
            "/transactions/daily",
            "/transactions/export",
          ];
          const answers = await whileCreditsLocked(async () => {
            const sent = [];
            for (const path of paths) {
              const answer = await within(request(path, true), 10_000);
              sent.push(
                answer === "waited"
                  ? { path, waited: true }
                  : {
                      path,
                      status: answer.status,
                      body: await answer.json(),
                    },
              );
            }
            // The control: the same wallet on Mainnet does wait for the lock.
            const mainnetRead = request("/users/me/credits", false);
            sent.push({
              path: "Mainnet control",
              waited: (await within(mainnetRead, 1_000)) === "waited",
            });
            return { sent, mainnetRead };
          });

          for (const path of paths) {
            expect(answers.sent).toContainEqual({
              path,
              status: 403,
              body: expect.objectContaining({
                kind: "preprod_access_required",
              }),
            });
          }
          for (const answer of answers.sent.slice(0, paths.length)) {
            expect(JSON.stringify(answer)).not.toMatch(/spendable|credits"?:/);
          }
          expect(answers.sent.at(-1)).toEqual({
            path: "Mainnet control",
            waited: true,
          });
          // Released, the Mainnet read answers with the wallet.
          const released = await answers.mainnetRead;
          expect(released.status).toBe(200);
          expect(
            ((await released.json()) as { data: { spendable: number } }).data
              .spendable,
          ).toBe(9);
        },
        CASE_TIMEOUT,
      );
    });
  },
);

/**
 * Today's layout, Preprod off: the admin route's real write. A Preprod
 * header changes nothing: the grant is Mainnet's, and the target has it.
 */
describe.runIf(onPostgres && !onSplitLayout)(
  "the admin grant under a Preprod header (PostgreSQL, today's layout)",
  () => {
    it(
      "grants the target Mainnet's credits",
      async () => {
        const fixture = await import("@/test-fixtures/core-session");
        const { default: prisma } = await import("@/lib/db/prisma");
        const { createNetworkScope } = await import("@/lib/db/network-scope");
        const app = fixture.createCoreApp();
        const admin = await fixture.createPasswordUser(
          "Admin grant fixture",
          "admin",
        );
        const targetId = randomUUID();
        await prisma.user.create({
          data: {
            id: targetId,
            name: "Admin grant target",
            email: `${targetId}@example.test`,
            emailVerified: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });
        const cookie = await fixture.signIn(app, admin.email);

        const response = await app.request(
          `${fixture.ORIGIN}/v1/admin/credits`,
          {
            method: "POST",
            headers: {
              cookie,
              origin: fixture.ORIGIN,
              "content-type": "application/json",
              [HEADER]: "preprod",
            },
            body: JSON.stringify({
              targetType: "user",
              targetId,
              credits: 5,
              ttlDays: 30,
              referenceNote: "Preprod header fixture",
            }),
          },
        );

        expect(response.status).toBe(200);
        const db = createNetworkScope("mainnet").networkDb;
        expect(
          await db.creditBucket.findMany({
            where: { userId: targetId },
            select: { amount: true, referenceType: true },
          }),
        ).toEqual([{ amount: 5n * CREDIT, referenceType: "FREE" }]);
        expect(
          await db.transaction.findMany({
            where: { userId: targetId },
            select: { amount: true },
          }),
        ).toEqual([{ amount: 5n * CREDIT }]);
      },
      CASE_TIMEOUT,
    );
  },
);
