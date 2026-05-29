import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import { type Prisma as PrismaType } from "../generated/prisma/client.js";

import {
  fetchOrganizationMemberUserIds,
  resolveOrganizationFreeCreditAudience,
} from "./organization-subscription-credit-audience.js";

function createMemberClient(
  members: Array<{ seatAssignedAt: Date | null; userId: string }>,
) {
  const findManyMembersMock = vi.fn().mockResolvedValue(members);

  return {
    findManyMembersMock,
    tx: {
      member: {
        findMany: findManyMembersMock,
      },
    } as unknown as PrismaType.TransactionClient,
  };
}

describe("fetchOrganizationMemberUserIds", () => {
  it("returns all organization members regardless of seat assignment", async () => {
    const { findManyMembersMock, tx } = createMemberClient([
      {
        seatAssignedAt: new Date("2026-04-01T00:00:00.000Z"),
        userId: "assigned-1",
      },
      { seatAssignedAt: null, userId: "unassigned-1" },
    ]);

    const userIds = await fetchOrganizationMemberUserIds("org-1", tx);

    assert.deepEqual(userIds, ["assigned-1", "unassigned-1"]);
    assert.deepEqual(findManyMembersMock.mock.calls[0]?.[0], {
      orderBy: [{ userId: "asc" }],
      select: { userId: true },
      where: { organizationId: "org-1" },
    });
  });
});

describe("resolveOrganizationFreeCreditAudience", () => {
  it("uses all members for local-free organizations", async () => {
    const { tx } = createMemberClient([
      {
        seatAssignedAt: new Date("2026-04-01T00:00:00.000Z"),
        userId: "assigned-1",
      },
      { seatAssignedAt: null, userId: "unassigned-1" },
    ]);

    const audience = await resolveOrganizationFreeCreditAudience(
      "org-1",
      { stripeSubscriptionId: null },
      tx,
    );

    assert.deepEqual(audience, {
      kind: "local_free_org",
      memberUserIds: ["assigned-1", "unassigned-1"],
    });
  });

  it("uses unassigned members only for paid organizations", async () => {
    const { findManyMembersMock, tx } = createMemberClient([
      { seatAssignedAt: null, userId: "unassigned-1" },
    ]);

    const audience = await resolveOrganizationFreeCreditAudience(
      "org-1",
      { stripeSubscriptionId: "sub_stripe_1" },
      tx,
    );

    assert.deepEqual(audience, {
      kind: "paid_org_unassigned_free",
      memberUserIds: ["unassigned-1"],
    });
    assert.deepEqual(findManyMembersMock.mock.calls[0]?.[0], {
      orderBy: [{ userId: "asc" }],
      select: { userId: true },
      where: {
        organizationId: "org-1",
        seatAssignedAt: null,
      },
    });
  });
});
