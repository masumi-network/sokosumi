/**
 * A spend from a transaction of either side, on a real PostgreSQL.
 *
 * On the shared side the plan and Seat rows are read through models; on a
 * Network side the same rows are read in raw SQL on that connection
 * (`resolveCreditBucketScopeContextInSql`). The two readings are two copies
 * of one rule, so the first test holds them together: for every kind of plan
 * and member, the balance read from each side is the same.
 */
import { randomUUID } from "node:crypto";
import { creditBucketRepository } from "@sokosumi/database/repositories";
import { afterAll, describe, expect, it } from "vitest";

import { spend } from "@/lib/credits/spend";
import { createNetworkScope } from "@/lib/db/network-scope";
import prisma from "@/lib/db/prisma";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

/** Many Organizations and reads on a loaded machine, past Vitest's 5 s. */
const CASE_TIMEOUT = 60_000;
const CLEANUP_TIMEOUT = 60_000;
const DAY = 86_400_000;
const POOL = 100n;
const ENTERPRISE = 1000n;

const scope = createNetworkScope("mainnet");
const userIds: string[] = [];
const organizationIds: string[] = [];

async function createUser(): Promise<string> {
  const id = randomUUID();
  await prisma.user.create({
    data: {
      id,
      name: "Spend sides fixture",
      email: `${id}@example.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  userIds.push(id);
  return id;
}

async function grant(
  owner: { userId: string } | { organizationId: string },
  cents: bigint,
  enterprise = false,
): Promise<void> {
  await scope.networkDb.transaction.create({
    data: {
      amount: cents,
      ...owner,
      sourceCreditBucket: {
        create: {
          amount: cents,
          ...owner,
          ...(enterprise && {
            referenceType: "ENTERPRISE_PERIOD",
            referenceId: randomUUID(),
          }),
        },
      },
    },
  });
}

/**
 * An Organization with a seated member, a member without a Seat, a pool
 * bucket and an enterprise bucket: the balance tells which of them a payer
 * may spend (none 0, the pool 100, with the enterprise credits 1100).
 */
async function organization() {
  const id = `spend-sides-${randomUUID()}`;
  const [seated, unseated] = [await createUser(), await createUser()];
  await prisma.organization.create({
    data: {
      id,
      name: "Spend sides fixture",
      slug: id,
      members: {
        create: [
          { userId: seated, role: "owner", seatAssignedAt: new Date() },
          { userId: unseated, role: "member" },
        ],
      },
    },
  });
  organizationIds.push(id);
  await grant({ organizationId: id }, POOL);
  await grant({ organizationId: id }, ENTERPRISE, true);
  return { id, seated, unseated };
}

type Fixture = Awaited<ReturnType<typeof organization>>;

function subscription(
  organizationId: string,
  plan: string,
  period: { startsInDays: number; endsInDays: number },
  more: {
    status?: string;
    stripeSubscriptionId?: string;
    updatedAt?: Date;
  } = {},
) {
  return prisma.subscription.create({
    data: {
      plan,
      referenceId: organizationId,
      status: "active",
      periodStart: new Date(Date.now() + period.startsInDays * DAY),
      periodEnd: new Date(Date.now() + period.endsInDays * DAY),
      ...more,
    },
  });
}

function contract(organizationId: string, activatedDaysAgo: number) {
  return prisma.enterpriseContract.create({
    data: {
      organizationId,
      status: "active",
      periodCount: 12,
      activatedAt: new Date(Date.now() - activatedDaysAgo * DAY),
      seats: 5,
      centsPerMonth: 1n,
    },
  });
}

const THIS_MONTH = { startsInDays: -10, endsInDays: 20 };
const LAST_MONTH = { startsInDays: -40, endsInDays: -10 };
const NEXT_MONTH = { startsInDays: 20, endsInDays: 50 };

/** Each kind of plan, and what each payer may then spend. */
const plans: {
  name: string;
  arrange: (fixture: Fixture) => Promise<unknown>;
  seated: bigint;
  unseated: bigint;
  outsider: bigint;
  memberless: bigint;
}[] = [
  {
    name: "no subscription: the free plan, any member spends the pool",
    arrange: async () => undefined,
    seated: POOL,
    unseated: POOL,
    outsider: 0n,
    memberless: POOL,
  },
  {
    name: "a paid plan in its period: only a Seat spends",
    arrange: ({ id }) => subscription(id, "pro", THIS_MONTH),
    seated: POOL,
    unseated: 0n,
    outsider: 0n,
    memberless: POOL,
  },
  {
    name: "a Stripe-backed paid row beats a newer local free row of the same period",
    arrange: async ({ id }) => {
      await subscription(id, "pro", THIS_MONTH, {
        stripeSubscriptionId: `sub_${randomUUID()}`,
        updatedAt: new Date(Date.now() - DAY),
      });
      await subscription(id, "free", THIS_MONTH);
    },
    seated: POOL,
    unseated: 0n,
    outsider: 0n,
    memberless: POOL,
  },
  {
    name: "no row in its period: the latest started one counts, a pre-created one does not",
    arrange: async ({ id }) => {
      await subscription(id, "pro", LAST_MONTH);
      await subscription(id, "free", NEXT_MONTH);
    },
    seated: POOL,
    unseated: 0n,
    outsider: 0n,
    memberless: POOL,
  },
  {
    name: "a canceled paid row does not count",
    arrange: ({ id }) =>
      subscription(id, "pro", THIS_MONTH, { status: "canceled" }),
    seated: POOL,
    unseated: POOL,
    outsider: 0n,
    memberless: POOL,
  },
  {
    name: "an enterprise contract in its term: a Seat spends the enterprise credits too",
    arrange: ({ id }) => contract(id, 1),
    seated: POOL + ENTERPRISE,
    unseated: 0n,
    outsider: 0n,
    memberless: POOL + ENTERPRISE,
  },
  {
    name: "an enterprise contract past its term: a Seat spends the pool only",
    arrange: ({ id }) => contract(id, 3 * 365),
    seated: POOL,
    unseated: 0n,
    outsider: 0n,
    memberless: POOL,
  },
];

describe.skipIf(!enabled)(
  "a spend from either side's transaction (PostgreSQL)",
  () => {
    afterAll(async () => {
      const billedTo = {
        OR: [
          { userId: { in: userIds } },
          { organizationId: { in: organizationIds } },
        ],
      };
      await scope.networkDb.creditConsumption.deleteMany({
        where: { transaction: billedTo },
      });
      await scope.networkDb.creditBucket.deleteMany({ where: billedTo });
      await scope.networkDb.transaction.deleteMany({ where: billedTo });
      await prisma.subscription.deleteMany({
        where: { referenceId: { in: organizationIds } },
      });
      await prisma.organization.deleteMany({
        where: { id: { in: organizationIds } },
      });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }, CLEANUP_TIMEOUT);

    it(
      "reads the same plan and Seat from a Network-side connection as from the shared side",
      async () => {
        const outsider = await createUser();
        for (const plan of plans) {
          const fixture = await organization();
          await plan.arrange(fixture);
          const payers = [
            fixture.seated,
            fixture.unseated,
            outsider,
            null,
          ] as const;
          const balances = async (side: "shared" | "network") => {
            const read = [];
            for (const userId of payers) {
              read.push(
                await creditBucketRepository.getBalanceOn(
                  "mainnet",
                  userId,
                  fixture.id,
                  side === "shared"
                    ? { shared: scope.sharedDb }
                    : { network: scope.networkDb },
                ),
              );
            }
            return read;
          };
          const expected = [
            plan.seated,
            plan.unseated,
            plan.outsider,
            plan.memberless,
          ];

          expect([plan.name, await balances("shared")]).toEqual([
            plan.name,
            expected,
          ]);
          expect([plan.name, await balances("network")]).toEqual([
            plan.name,
            expected,
          ]);
        }
      },
      CASE_TIMEOUT,
    );

    it(
      "writes the same debit from a Network-side transaction as from a shared-side one, and rolls back with it",
      async () => {
        const fixture = await organization();
        await subscription(fixture.id, "pro", THIS_MONTH);
        const payer = {
          userId: fixture.seated,
          organizationId: fixture.id,
          projectId: null,
        };
        const debits = () =>
          scope.networkDb.transaction.findMany({
            where: { organizationId: fixture.id, amount: { lte: 0n } },
            orderBy: { id: "asc" },
            select: {
              amount: true,
              userId: true,
              creditConsumptions: { select: { amount: true } },
            },
          });

        const onShared = await scope.sharedTransaction(
          (tx) =>
            spend({
              scope,
              tx: { shared: tx },
              payer,
              quotedCents: 30n,
              mode: "in_full",
            }),
          "conflict",
          "Serializable",
        );
        const onNetwork = await scope.netTransaction(
          (tx) =>
            spend({
              scope,
              tx: { network: tx },
              payer,
              quotedCents: 30n,
              mode: "in_full",
            }),
          "conflict",
          "Serializable",
        );
        // A member without a Seat is refused on the Network side as on the shared one.
        const unseated = await scope.netTransaction(
          (tx) =>
            spend({
              scope,
              tx: { network: tx },
              payer: { ...payer, userId: fixture.unseated },
              quotedCents: 30n,
              mode: "in_full",
            }),
          "conflict",
        );
        await expect(
          scope.netTransaction(async (tx) => {
            await spend({
              scope,
              tx: { network: tx },
              payer,
              quotedCents: 30n,
              mode: "in_full",
            });
            throw new Error("the caller's receipt failed");
          }, "conflict"),
        ).rejects.toThrow("the caller's receipt failed");

        expect([onShared.outcome, onNetwork.outcome, unseated]).toEqual([
          "charged",
          "charged",
          {
            outcome: "not_charged",
            transactionId: null,
            quotedCents: 30n,
            chargedCents: 0n,
            shortfall: true,
            availableCents: 0n,
          },
        ]);
        const debit = {
          amount: -30n,
          userId: fixture.seated,
          creditConsumptions: [{ amount: 30n }],
        };
        expect(await debits()).toEqual([debit, debit]);
      },
      CASE_TIMEOUT,
    );

    it(
      "charges what is left, and records a price of zero, as their modes say",
      async () => {
        const userId = await createUser();
        await grant({ userId }, 90n);
        const payer = { userId, organizationId: null, projectId: null };

        const zero = await scope.sharedTransaction(
          (tx) =>
            spend({
              scope,
              tx: { shared: tx },
              payer,
              quotedCents: 0n,
              mode: "in_full_or_zero",
            }),
          "conflict",
          "Serializable",
        );
        const partly = await scope.sharedTransaction(
          (tx) =>
            spend({
              scope,
              tx: { shared: tx },
              payer,
              quotedCents: 120n,
              mode: "up_to_balance",
            }),
          "conflict",
          "Serializable",
        );
        const empty = await scope.sharedTransaction(
          (tx) =>
            spend({
              scope,
              tx: { shared: tx },
              payer,
              quotedCents: 120n,
              mode: "up_to_balance",
            }),
          "conflict",
          "Serializable",
        );

        expect(zero).toMatchObject({
          outcome: "recorded_zero",
          quotedCents: 0n,
          chargedCents: 0n,
          shortfall: false,
        });
        expect(partly).toMatchObject({
          outcome: "partly_charged",
          quotedCents: 120n,
          chargedCents: 90n,
          shortfall: true,
        });
        expect(empty).toEqual({
          outcome: "not_charged",
          transactionId: null,
          quotedCents: 120n,
          chargedCents: 0n,
          shortfall: true,
          availableCents: 0n,
        });
        const written = await scope.networkDb.transaction.findMany({
          where: { userId, amount: { lte: 0n } },
          // Not by id: two ids of one millisecond have no order.
          orderBy: { amount: "desc" },
          select: {
            id: true,
            amount: true,
            creditConsumptions: { select: { amount: true } },
          },
        });
        expect(written).toEqual([
          { id: zero.transactionId, amount: 0n, creditConsumptions: [] },
          {
            id: partly.transactionId,
            amount: -90n,
            creditConsumptions: [{ amount: 90n }],
          },
        ]);
      },
      CASE_TIMEOUT,
    );
  },
);
