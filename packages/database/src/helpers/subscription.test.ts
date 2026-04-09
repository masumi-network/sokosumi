import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import type { Prisma } from "../generated/prisma/client.js";

import {
  buildLocalFreeOrganizationMemberSubscriptionReferenceId,
  buildLocalFreeUserSubscriptionReferenceId,
  ensureInitialLocalFreeSubscriptionPeriod,
  ensureLocalFreeSubscriptionPeriod,
  getNextMonthlyPeriodEnd,
} from "./subscription.js";

function createTransactionClient(params?: {
  members?: Array<{ role?: string; userId: string }>;
  existingBucketReferenceIds?: string[];
  existingSubscriptionId?: null | string;
}) {
  const findSubscriptionMock = vi.fn().mockResolvedValue(
    params?.existingSubscriptionId
      ? {
          id: params.existingSubscriptionId,
        }
      : null,
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
    } as unknown as Prisma.TransactionClient,
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
      ).toISOString(),
      "2026-05-08T12:30:00.000Z",
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
    assert.equal(createSubscriptionMock.mock.calls[0]?.[0].data.seats, 1);
    assert.equal(findUniqueBucketMock.mock.calls.length, 1);
    assert.equal(createTransactionMock.mock.calls.length, 1);
  });

  it("creates an organization subscription row and grants one bucket per member seat", async () => {
    const { createSubscriptionMock, createTransactionMock, tx } =
      createTransactionClient();

    const result = await ensureLocalFreeSubscriptionPeriod(
      {
        memberUserIds: ["member-1", "member-1", "owner-1"],
        organizationId: "org-1",
        periodEnd: new Date("2026-05-01T00:00:00.000Z"),
        periodStart: new Date("2026-04-01T00:00:00.000Z"),
        referenceId: "org-1",
      },
      tx,
    );

    assert.deepEqual(result, {
      grantsCreated: 2,
      subscriptionCreated: true,
      subscriptionId: "subscription-local-free",
    });
    assert.equal(createSubscriptionMock.mock.calls.length, 1);
    assert.equal(createSubscriptionMock.mock.calls[0]?.[0].data.seats, 2);
    assert.equal(createTransactionMock.mock.calls.length, 2);
  });

  it("throws when an organization period is created without members", async () => {
    const { tx } = createTransactionClient();

    await assert.rejects(
      ensureLocalFreeSubscriptionPeriod(
        {
          memberUserIds: [],
          organizationId: "org-1",
          periodEnd: new Date("2026-05-01T00:00:00.000Z"),
          periodStart: new Date("2026-04-01T00:00:00.000Z"),
          referenceId: "org-1",
        },
        tx,
      ),
      /Cannot create local free subscription period for organization org-1: no members found/,
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
    assert.equal(typeof createdPersonalSubscription.id, "string");
    assert.deepEqual(createdPersonalSubscription, {
      billingInterval: "month",
      cancelAtPeriodEnd: false,
      id: createdPersonalSubscription.id,
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
      grantsCreated: 2,
      subscriptionCreated: true,
      subscriptionId: "subscription-local-free",
    });
    assert.equal(findManyMembersMock.mock.calls.length, 1);
    assert.deepEqual(findManyMembersMock.mock.calls[0]?.[0], {
      where: {
        organizationId: "org-1",
      },
    });
    assert.equal(createSubscriptionMock.mock.calls.length, 1);
    const createdOrganizationSubscription =
      createSubscriptionMock.mock.calls[0]?.[0].data;
    assert.equal(typeof createdOrganizationSubscription.id, "string");
    assert.deepEqual(createdOrganizationSubscription, {
      billingInterval: "month",
      cancelAtPeriodEnd: false,
      id: createdOrganizationSubscription.id,
      periodEnd: new Date("2026-05-01T10:00:00.000Z"),
      periodStart: new Date("2026-04-01T10:00:00.000Z"),
      plan: "free",
      referenceId: "org-1",
      seats: 2,
      status: "active",
      stripeCustomerId: "cus_org_1",
      stripeSubscriptionId: null,
    });
    assert.equal(createTransactionMock.mock.calls.length, 2);
  });

  it("throws when the initial organization period has no members", async () => {
    const { tx } = createTransactionClient({
      members: [],
    });

    await assert.rejects(
      ensureInitialLocalFreeSubscriptionPeriod(
        {
          createdAt: new Date("2026-04-01T10:00:00.000Z"),
          kind: "organization",
          organizationId: "org-1",
          stripeCustomerId: "cus_org_1",
        },
        tx,
      ),
      /Cannot create local free subscription period for organization org-1: no members found/,
    );
  });
});
