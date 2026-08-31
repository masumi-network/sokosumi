import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import { type Prisma as PrismaType } from "../generated/prisma/client.js";
import {
  buildLocalFreeOrganizationMemberSubscriptionReferenceId,
  buildLocalFreeOrganizationSubscriptionReferenceId,
  buildLocalFreeUserSubscriptionReferenceId,
  ensureInitialLocalFreeSubscriptionPeriod,
  ensureLocalFreeSubscriptionPeriod,
  ensureNextLocalFreeSubscriptionPeriod,
  getNextMonthlyPeriodEnd,
  transitionToNextLocalFreeSubscriptionPeriod,
} from "./subscription.js";

function createTransactionClient(params?: {
  members?: Array<{ role?: string; userId: string }>;
  existingBucketReferenceIds?: string[];
  existingSubscriptionId?: null | string;
}) {
  const findSubscriptionMock = vi.fn().mockImplementation(() =>
    Promise.resolve(
      params?.existingSubscriptionId
        ? {
            id: params.existingSubscriptionId,
          }
        : null,
    ),
  );
  const createSubscriptionMock = vi.fn().mockResolvedValue({
    id: "subscription-local-free",
  });
  const findUniqueBucketMock = vi.fn().mockImplementation(
    ({
      where,
    }: {
      where: {
        referenceId_referenceType: {
          referenceId: string;
        };
      };
    }) =>
      Promise.resolve(
        params?.existingBucketReferenceIds?.includes(
          where.referenceId_referenceType.referenceId,
        )
          ? { id: "existing-bucket" }
          : null,
      ),
  );
  const createTransactionMock = vi.fn().mockResolvedValue({
    id: "tx_local_free",
  });
  const findManyMembersMock = vi.fn().mockResolvedValue(params?.members ?? []);

  return {
    createSubscriptionMock,
    createTransactionMock,
    findSubscriptionMock,
    findManyMembersMock,
    findUniqueBucketMock,
    tx: {
      creditBucket: {
        findUnique: findUniqueBucketMock,
      },
      member: {
        findMany: findManyMembersMock,
      },
      subscription: {
        create: createSubscriptionMock,
        findFirst: findSubscriptionMock,
      },
      transaction: {
        create: createTransactionMock,
      },
    } as unknown as PrismaType.TransactionClient,
  };
}

function createTransitionClient(params?: {
  members?: Array<{ userId: string }>;
  organization?: { id: string } | null;
  user?: { id: string } | null;
}) {
  const findManyMembersMock = vi.fn().mockResolvedValue(params?.members ?? []);
  const findOrganizationMock = vi
    .fn()
    .mockResolvedValue(params?.organization ?? null);
  const findUserMock = vi.fn().mockResolvedValue(params?.user ?? null);
  const updateSubscriptionMock = vi.fn().mockResolvedValue({
    id: "subscription-1",
  });
  const ensureTx = createTransactionClient({
    members: (params?.members ?? []).map((member) => ({
      userId: member.userId,
    })),
  });

  return {
    ...ensureTx,
    findManyMembersMock,
    findOrganizationMock,
    findUserMock,
    updateSubscriptionMock,
    tx: {
      ...ensureTx.tx,
      member: {
        findMany: findManyMembersMock,
      },
      organization: {
        findUnique: findOrganizationMock,
      },
      subscription: {
        ...ensureTx.tx.subscription,
        update: updateSubscriptionMock,
      },
      user: {
        findUnique: findUserMock,
      },
    } as unknown as PrismaType.TransactionClient,
  };
}

describe("local free subscription references", () => {
  it("builds personal reference ids", () => {
    assert.equal(
      buildLocalFreeUserSubscriptionReferenceId(
        "user-1",
        new Date("2026-05-01T00:00:00.000Z"),
      ),
      "user:user-1:local-free:2026-05-01T00:00:00.000Z:subscription",
    );
  });

  it("builds organization member reference ids with organization context", () => {
    assert.equal(
      buildLocalFreeOrganizationMemberSubscriptionReferenceId(
        "user-1",
        "org-1",
        new Date("2026-05-01T00:00:00.000Z"),
      ),
      "member:user-1:local-free:org-1:2026-05-01T00:00:00.000Z",
    );
  });
});

describe("getNextMonthlyPeriodEnd", () => {
  it("advances the period by one calendar month", () => {
    assert.equal(
      getNextMonthlyPeriodEnd(
        new Date("2026-04-08T12:30:00.000Z"),
        new Date("2026-04-08T12:30:00.000Z"),
      ).toISOString(),
      "2026-05-08T12:30:00.000Z",
    );
  });

  it("clamps january month-end periods into february", () => {
    assert.equal(
      getNextMonthlyPeriodEnd(
        new Date("2026-01-31T10:00:00.000Z"),
        new Date("2026-01-31T10:00:00.000Z"),
      ).toISOString(),
      "2026-02-28T10:00:00.000Z",
    );
  });

  it("preserves leap-day capacity when february supports it", () => {
    assert.equal(
      getNextMonthlyPeriodEnd(
        new Date("2028-01-31T10:00:00.000Z"),
        new Date("2028-01-31T10:00:00.000Z"),
      ).toISOString(),
      "2028-02-29T10:00:00.000Z",
    );
  });

  it("clamps 31-day month ends into shorter target months", () => {
    assert.equal(
      getNextMonthlyPeriodEnd(
        new Date("2026-03-31T10:00:00.000Z"),
        new Date("2026-03-31T10:00:00.000Z"),
      ).toISOString(),
      "2026-04-30T10:00:00.000Z",
    );
  });
});

describe("ensureLocalFreeSubscriptionPeriod", () => {
  it("creates a personal subscription row and initial grant", async () => {
    const {
      createSubscriptionMock,
      createTransactionMock,
      findSubscriptionMock,
      findUniqueBucketMock,
      tx,
    } = createTransactionClient();

    const result = await ensureLocalFreeSubscriptionPeriod(
      {
        billingAnchorDate: new Date("2026-04-01T00:00:00.000Z"),
        organizationId: null,
        userId: "user-1",
        periodEnd: new Date("2026-05-01T00:00:00.000Z"),
        periodStart: new Date("2026-04-01T00:00:00.000Z"),
        referenceId: "user-1",
      },
      tx,
    );

    assert.deepEqual(result, {
      grantsCreated: 1,
      subscriptionCreated: true,
      subscriptionId: "subscription-local-free",
    });
    assert.equal(findSubscriptionMock.mock.calls.length, 1);
    assert.equal(createSubscriptionMock.mock.calls.length, 1);
    assert.equal(
      createSubscriptionMock.mock.calls[0]?.[0].data.createdAt?.toISOString(),
      "2026-04-01T00:00:00.000Z",
    );
    assert.equal(createSubscriptionMock.mock.calls[0]?.[0].data.seats, 1);
    assert.equal(findUniqueBucketMock.mock.calls.length, 1);
    assert.equal(createTransactionMock.mock.calls.length, 1);
    assert.equal(
      createTransactionMock.mock.calls[0]?.[0].data.sourceCreditBucket.create
        .activatesAt,
      null,
    );
  });

  it("stores activatesAt on new buckets when provided", async () => {
    const activatesAt = new Date("2026-05-01T00:00:00.000Z");
    const { createTransactionMock, tx } = createTransactionClient();

    await ensureLocalFreeSubscriptionPeriod(
      {
        activatesAt,
        billingAnchorDate: new Date("2026-04-01T00:00:00.000Z"),
        organizationId: null,
        userId: "user-1",
        periodEnd: new Date("2026-06-01T00:00:00.000Z"),
        periodStart: new Date("2026-05-01T00:00:00.000Z"),
        referenceId: "user-1",
      },
      tx,
    );

    assert.equal(
      createTransactionMock.mock.calls[0]?.[0].data.sourceCreditBucket.create
        .activatesAt,
      activatesAt,
    );
  });

  it("creates an organization subscription row and grants one org-owned free period bucket", async () => {
    const { createSubscriptionMock, createTransactionMock, tx } =
      createTransactionClient();

    const result = await ensureLocalFreeSubscriptionPeriod(
      {
        billingAnchorDate: new Date("2026-04-01T00:00:00.000Z"),
        organizationId: "org-1",
        periodEnd: new Date("2026-05-01T00:00:00.000Z"),
        periodStart: new Date("2026-04-01T00:00:00.000Z"),
        referenceId: "org-1",
      },
      tx,
    );

    assert.deepEqual(result, {
      grantsCreated: 1,
      subscriptionCreated: true,
      subscriptionId: "subscription-local-free",
    });
    assert.equal(createSubscriptionMock.mock.calls.length, 1);
    assert.equal(
      createSubscriptionMock.mock.calls[0]?.[0].data.createdAt?.toISOString(),
      "2026-04-01T00:00:00.000Z",
    );
    assert.equal(createSubscriptionMock.mock.calls[0]?.[0].data.seats, 1);
    assert.equal(createTransactionMock.mock.calls.length, 1);
    assert.equal(createTransactionMock.mock.calls[0]?.[0].data.userId, null);
    assert.equal(
      createTransactionMock.mock.calls[0]?.[0].data.organizationId,
      "org-1",
    );
    assert.equal(
      createTransactionMock.mock.calls[0]?.[0].data.sourceCreditBucket.create
        .userId,
      null,
    );
  });

  it("does not mint an org-owned free period when the org local-free sentinel fingerprint exists", async () => {
    const periodEnd = new Date("2026-05-01T00:00:00.000Z");
    const sentinelReferenceId =
      buildLocalFreeOrganizationSubscriptionReferenceId("org-1", periodEnd);
    const { createTransactionMock, tx } = createTransactionClient({
      existingBucketReferenceIds: [sentinelReferenceId],
    });

    const result = await ensureLocalFreeSubscriptionPeriod(
      {
        billingAnchorDate: new Date("2026-04-01T00:00:00.000Z"),
        organizationId: "org-1",
        periodEnd,
        periodStart: new Date("2026-04-01T00:00:00.000Z"),
        referenceId: "org-1",
      },
      tx,
    );

    assert.deepEqual(result, {
      grantsCreated: 0,
      subscriptionCreated: true,
      subscriptionId: "subscription-local-free",
    });
    assert.equal(createTransactionMock.mock.calls.length, 0);
  });

  it("still mints an org-owned free period when no org local-free fingerprint exists for that periodEnd", async () => {
    const { createTransactionMock, tx } = createTransactionClient();

    const result = await ensureLocalFreeSubscriptionPeriod(
      {
        billingAnchorDate: new Date("2026-04-01T00:00:00.000Z"),
        organizationId: "org-1",
        periodEnd: new Date("2026-05-01T00:00:00.000Z"),
        periodStart: new Date("2026-04-01T00:00:00.000Z"),
        referenceId: "org-1",
      },
      tx,
    );

    assert.deepEqual(result, {
      grantsCreated: 1,
      subscriptionCreated: true,
      subscriptionId: "subscription-local-free",
    });
    assert.equal(createTransactionMock.mock.calls.length, 1);
  });

  it("allows organization periods with no unassigned members", async () => {
    const { createSubscriptionMock, createTransactionMock, tx } =
      createTransactionClient();

    const result = await ensureLocalFreeSubscriptionPeriod(
      {
        billingAnchorDate: new Date("2026-04-01T00:00:00.000Z"),
        organizationId: "org-1",
        periodEnd: new Date("2026-05-01T00:00:00.000Z"),
        periodStart: new Date("2026-04-01T00:00:00.000Z"),
        purchasedSeats: 3,
        referenceId: "org-1",
      },
      tx,
    );

    assert.deepEqual(result, {
      grantsCreated: 1,
      subscriptionCreated: true,
      subscriptionId: "subscription-local-free",
    });
    assert.equal(createSubscriptionMock.mock.calls[0]?.[0].data.seats, 3);
    assert.equal(createTransactionMock.mock.calls.length, 1);
    assert.equal(createTransactionMock.mock.calls[0]?.[0].data.userId, null);
    assert.equal(
      createTransactionMock.mock.calls[0]?.[0].data.organizationId,
      "org-1",
    );
  });

  it("uses purchasedSeats instead of assigned member count for organization rows", async () => {
    const { createSubscriptionMock, tx } = createTransactionClient();

    await ensureLocalFreeSubscriptionPeriod(
      {
        billingAnchorDate: new Date("2026-04-01T00:00:00.000Z"),
        organizationId: "org-1",
        periodEnd: new Date("2026-05-01T00:00:00.000Z"),
        periodStart: new Date("2026-04-01T00:00:00.000Z"),
        purchasedSeats: 5,
        referenceId: "org-1",
      },
      tx,
    );

    assert.equal(createSubscriptionMock.mock.calls[0]?.[0].data.seats, 5);
  });

  it("does not throw when an organization period has no unassigned members", async () => {
    const { tx } = createTransactionClient();

    await assert.doesNotReject(
      ensureLocalFreeSubscriptionPeriod(
        {
          billingAnchorDate: new Date("2026-04-01T00:00:00.000Z"),
          organizationId: "org-1",
          periodEnd: new Date("2026-05-01T00:00:00.000Z"),
          periodStart: new Date("2026-04-01T00:00:00.000Z"),
          referenceId: "org-1",
        },
        tx,
      ),
    );
  });

  it("reuses an existing subscription row and skips duplicate grants", async () => {
    const { createSubscriptionMock, createTransactionMock, tx } =
      createTransactionClient({
        existingBucketReferenceIds: [
          "user:user-1:local-free:2026-05-01T00:00:00.000Z:subscription",
        ],
        existingSubscriptionId: "subscription-existing",
      });

    const result = await ensureLocalFreeSubscriptionPeriod(
      {
        billingAnchorDate: new Date("2026-04-01T00:00:00.000Z"),
        organizationId: null,
        userId: "user-1",
        periodEnd: new Date("2026-05-01T00:00:00.000Z"),
        periodStart: new Date("2026-04-01T00:00:00.000Z"),
        referenceId: "user-1",
      },
      tx,
    );

    assert.deepEqual(result, {
      grantsCreated: 0,
      subscriptionCreated: false,
      subscriptionId: "subscription-existing",
    });
    assert.equal(createSubscriptionMock.mock.calls.length, 0);
    assert.equal(createTransactionMock.mock.calls.length, 0);
  });
});

describe("ensureNextLocalFreeSubscriptionPeriod", () => {
  it("defaults activatesAt to the next period start when omitted", async () => {
    vi.useFakeTimers();
    const { createTransactionMock, tx } = createTransitionClient({
      organization: null,
      user: { id: "user-1" },
    });

    await ensureNextLocalFreeSubscriptionPeriod(
      {
        subscription: {
          canceledAt: null,
          createdAt: new Date("2026-01-30T10:00:00.000Z"),
          endedAt: null,
          id: "subscription-source",
          periodEnd: new Date("2026-02-28T10:00:00.000Z"),
          referenceId: "user-1",
          seats: null,
          stripeCustomerId: "cus_1",
          stripeSubscriptionId: null,
        },
      },
      tx,
    );

    assert.equal(
      createTransactionMock.mock.calls[0]?.[0].data.sourceCreditBucket.create.activatesAt?.toISOString(),
      "2026-02-28T10:00:00.000Z",
    );
    vi.useRealTimers();
  });

  it("forwards explicit activatesAt to ensureLocalFreeSubscriptionPeriod", async () => {
    const activatesAt = new Date("2026-06-01T00:00:00.000Z");
    const { createTransactionMock, tx } = createTransitionClient({
      organization: null,
      user: { id: "user-1" },
    });

    await ensureNextLocalFreeSubscriptionPeriod(
      {
        activatesAt,
        subscription: {
          canceledAt: null,
          createdAt: new Date("2026-04-01T00:00:00.000Z"),
          endedAt: null,
          id: "subscription-source",
          periodEnd: new Date("2026-05-01T00:00:00.000Z"),
          referenceId: "user-1",
          seats: null,
          stripeCustomerId: "cus_1",
          stripeSubscriptionId: null,
        },
      },
      tx,
    );

    assert.equal(
      createTransactionMock.mock.calls[0]?.[0].data.sourceCreditBucket.create
        .activatesAt,
      activatesAt,
    );
  });
});

describe("ensureInitialLocalFreeSubscriptionPeriod", () => {
  it("creates the initial personal free subscription period from createdAt", async () => {
    const { createSubscriptionMock, createTransactionMock, tx } =
      createTransactionClient();

    const result = await ensureInitialLocalFreeSubscriptionPeriod(
      {
        createdAt: new Date("2026-04-01T10:00:00.000Z"),
        kind: "user",
        stripeCustomerId: "cus_user_1",
        userId: "user-1",
      },
      tx,
    );

    assert.deepEqual(result, {
      grantsCreated: 1,
      subscriptionCreated: true,
      subscriptionId: "subscription-local-free",
    });
    assert.equal(createSubscriptionMock.mock.calls.length, 1);
    const createdPersonalSubscription =
      createSubscriptionMock.mock.calls[0]?.[0].data;
    assert.deepEqual(createdPersonalSubscription, {
      billingInterval: "month",
      cancelAtPeriodEnd: false,
      createdAt: new Date("2026-04-01T10:00:00.000Z"),
      periodEnd: new Date("2026-05-01T10:00:00.000Z"),
      periodStart: new Date("2026-04-01T10:00:00.000Z"),
      plan: "free",
      referenceId: "user-1",
      seats: 1,
      status: "active",
      stripeCustomerId: "cus_user_1",
      stripeSubscriptionId: null,
    });
    assert.equal(createTransactionMock.mock.calls.length, 1);
  });

  it("throws when createdAt is an invalid date", async () => {
    const { tx } = createTransactionClient();

    await assert.rejects(
      ensureInitialLocalFreeSubscriptionPeriod(
        {
          createdAt: new Date("not-a-date"),
          kind: "user",
          stripeCustomerId: "cus_user_1",
          userId: "user-1",
        },
        tx,
      ),
      /Invalid subscription period start date/,
    );
  });

  it("creates the initial organization free subscription period from createdAt and current members", async () => {
    const {
      createSubscriptionMock,
      createTransactionMock,
      findManyMembersMock,
      tx,
    } = createTransactionClient({
      members: [
        { role: "MEMBER", userId: "member-1" },
        { role: "OWNER", userId: "owner-1" },
        { role: "MEMBER", userId: "assigned-1" },
      ],
    });

    const result = await ensureInitialLocalFreeSubscriptionPeriod(
      {
        createdAt: new Date("2026-04-01T10:00:00.000Z"),
        kind: "organization",
        organizationId: "org-1",
        stripeCustomerId: "cus_org_1",
      },
      tx,
    );

    assert.deepEqual(result, {
      grantsCreated: 1,
      subscriptionCreated: true,
      subscriptionId: "subscription-local-free",
    });
    assert.equal(findManyMembersMock.mock.calls.length, 1);
    assert.deepEqual(findManyMembersMock.mock.calls[0]?.[0], {
      select: {
        userId: true,
      },
      where: {
        organizationId: "org-1",
      },
      orderBy: [{ userId: "asc" }],
    });
    assert.equal(createSubscriptionMock.mock.calls.length, 1);
    const createdOrganizationSubscription =
      createSubscriptionMock.mock.calls[0]?.[0].data;
    assert.deepEqual(createdOrganizationSubscription, {
      billingInterval: "month",
      cancelAtPeriodEnd: false,
      createdAt: new Date("2026-04-01T10:00:00.000Z"),
      periodEnd: new Date("2026-05-01T10:00:00.000Z"),
      periodStart: new Date("2026-04-01T10:00:00.000Z"),
      plan: "free",
      referenceId: "org-1",
      seats: 1,
      status: "active",
      stripeCustomerId: "cus_org_1",
      stripeSubscriptionId: null,
    });
    assert.equal(createTransactionMock.mock.calls.length, 1);
  });

  it("creates the initial organization free subscription period with no members", async () => {
    const {
      createSubscriptionMock,
      createTransactionMock,
      findManyMembersMock,
      tx,
    } = createTransactionClient({
      members: [],
    });

    const result = await ensureInitialLocalFreeSubscriptionPeriod(
      {
        createdAt: new Date("2026-04-01T10:00:00.000Z"),
        kind: "organization",
        organizationId: "org-1",
        stripeCustomerId: "cus_org_1",
      },
      tx,
    );

    assert.deepEqual(result, {
      grantsCreated: 1,
      subscriptionCreated: true,
      subscriptionId: "subscription-local-free",
    });
    assert.equal(findManyMembersMock.mock.calls.length, 1);
    assert.equal(createSubscriptionMock.mock.calls.length, 1);
    assert.equal(createTransactionMock.mock.calls.length, 1);
    assert.equal(createTransactionMock.mock.calls[0]?.[0].data.userId, null);
    assert.equal(
      createTransactionMock.mock.calls[0]?.[0].data.organizationId,
      "org-1",
    );
  });
});

describe("transitionToNextLocalFreeSubscriptionPeriod", () => {
  it("creates the next personal local free period and closes out the source subscription", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-09T00:00:00.000Z"));
    const {
      createSubscriptionMock,
      createTransactionMock,
      tx,
      updateSubscriptionMock,
    } = createTransitionClient({
      organization: null,
      user: { id: "user-1" },
    });

    await transitionToNextLocalFreeSubscriptionPeriod(
      {
        setCanceledAt: true,
        subscription: {
          canceledAt: null,
          createdAt: new Date("2026-01-30T10:00:00.000Z"),
          endedAt: null,
          id: "subscription-source",
          periodEnd: new Date("2026-02-28T10:00:00.000Z"),
          referenceId: "user-1",
          seats: null,
          stripeCustomerId: "cus_1",
          stripeSubscriptionId: "sub_stripe_source",
        },
      },
      tx,
    );

    assert.equal(
      createSubscriptionMock.mock.calls[0][0].data.periodEnd.toISOString(),
      "2026-03-30T10:00:00.000Z",
    );
    assert.equal(createTransactionMock.mock.calls.length, 1);
    assert.equal(
      createTransactionMock.mock.calls[0]?.[0].data.sourceCreditBucket.create
        .activatesAt,
      null,
    );
    assert.deepEqual(updateSubscriptionMock.mock.calls[0][0], {
      where: {
        id: "subscription-source",
      },
      data: {
        canceledAt: new Date("2026-04-09T00:00:00.000Z"),
        endedAt: new Date("2026-02-28T10:00:00.000Z"),
        status: "canceled",
      },
    });
    vi.useRealTimers();
  });

  it("sets future activatesAt when the next period has not started yet", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-01T00:00:00.000Z"));
    const { createTransactionMock, tx } = createTransitionClient({
      organization: null,
      user: { id: "user-1" },
    });

    await transitionToNextLocalFreeSubscriptionPeriod(
      {
        setCanceledAt: true,
        subscription: {
          canceledAt: null,
          createdAt: new Date("2026-03-01T00:00:00.000Z"),
          endedAt: null,
          id: "subscription-source",
          periodEnd: new Date("2026-04-15T00:00:00.000Z"),
          referenceId: "user-1",
          seats: null,
          stripeCustomerId: "cus_1",
          stripeSubscriptionId: null,
        },
      },
      tx,
    );

    assert.equal(
      createTransactionMock.mock.calls[0]?.[0].data.sourceCreditBucket.create.activatesAt?.toISOString(),
      "2026-04-15T00:00:00.000Z",
    );
    vi.useRealTimers();
  });

  it("creates the next organization local free period as one org-owned bucket", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-09T00:00:00.000Z"));
    const {
      createSubscriptionMock,
      createTransactionMock,
      findManyMembersMock,
      tx,
      updateSubscriptionMock,
    } = createTransitionClient({
      members: [{ userId: "assigned-1" }, { userId: "unassigned-1" }],
      organization: { id: "org-1" },
      user: null,
    });

    await transitionToNextLocalFreeSubscriptionPeriod(
      {
        setCanceledAt: true,
        subscription: {
          canceledAt: null,
          createdAt: new Date("2026-01-30T10:00:00.000Z"),
          endedAt: null,
          id: "subscription-source",
          periodEnd: new Date("2026-02-28T10:00:00.000Z"),
          referenceId: "org-1",
          seats: 3,
          stripeCustomerId: "cus_org_1",
          stripeSubscriptionId: null,
        },
      },
      tx,
    );

    assert.deepEqual(findManyMembersMock.mock.calls[0]?.[0], {
      orderBy: [{ userId: "asc" }],
      select: { userId: true },
      where: { organizationId: "org-1" },
    });
    assert.equal(createSubscriptionMock.mock.calls.length, 1);
    assert.equal(createTransactionMock.mock.calls.length, 1);
    assert.equal(
      createTransactionMock.mock.calls[0]?.[0].data.sourceCreditBucket.create
        .userId,
      null,
    );
    assert.equal(updateSubscriptionMock.mock.calls.length, 1);
    vi.useRealTimers();
  });

  it("marks stale subscriptions canceled when neither user nor organization exists", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-09T00:00:00.000Z"));
    const { tx, updateSubscriptionMock } = createTransitionClient({
      organization: null,
      user: null,
    });

    await transitionToNextLocalFreeSubscriptionPeriod(
      {
        setCanceledAt: false,
        subscription: {
          canceledAt: null,
          createdAt: new Date("2026-02-01T00:00:00.000Z"),
          endedAt: null,
          id: "subscription-stale",
          periodEnd: new Date("2026-03-01T00:00:00.000Z"),
          referenceId: "missing-user",
          seats: null,
          stripeCustomerId: null,
          stripeSubscriptionId: null,
        },
      },
      tx,
    );

    assert.deepEqual(updateSubscriptionMock.mock.calls[0][0], {
      where: {
        id: "subscription-stale",
      },
      data: {
        canceledAt: new Date("2026-04-09T00:00:00.000Z"),
        endedAt: new Date("2026-03-01T00:00:00.000Z"),
        status: "canceled",
      },
    });
    vi.useRealTimers();
  });

  it("closes out the source subscription when period end is missing", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-09T00:00:00.000Z"));
    const { createSubscriptionMock, tx, updateSubscriptionMock } =
      createTransitionClient({
        organization: null,
        user: { id: "user-1" },
      });

    await transitionToNextLocalFreeSubscriptionPeriod(
      {
        setCanceledAt: true,
        subscription: {
          canceledAt: null,
          createdAt: new Date("2026-02-01T00:00:00.000Z"),
          endedAt: null,
          id: "subscription-missing-period-end",
          periodEnd: null,
          referenceId: "user-1",
          seats: null,
          stripeCustomerId: "cus_1",
          stripeSubscriptionId: null,
        },
      },
      tx,
    );

    assert.deepEqual(updateSubscriptionMock.mock.calls[0][0], {
      where: {
        id: "subscription-missing-period-end",
      },
      data: {
        canceledAt: new Date("2026-04-09T00:00:00.000Z"),
        endedAt: new Date("2026-04-09T00:00:00.000Z"),
        status: "canceled",
      },
    });
    assert.equal(createSubscriptionMock.mock.calls.length, 0);
    vi.useRealTimers();
  });
});
