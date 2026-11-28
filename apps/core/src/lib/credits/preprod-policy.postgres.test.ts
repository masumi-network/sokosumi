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

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  Boolean(process.env.DATABASE_URL?.startsWith("postgres")) &&
  onSplitLayout;

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
        "grants Mainnet credits from the admin route under a Preprod header",
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
  },
);
