import assert from "node:assert/strict";

import { describe, it, vi } from "vitest";
import { memberRepository } from "../repositories/member.repository.js";
import { hasAssignedOrganizationSeat } from "./credit-bucket-scope.js";
import { resolveOrganizationBillingPlan } from "./organization-billing-plan.js";
import {
  autoAssignSeatsOnPaidSubscribe,
  unassignSeatsOverPurchasedCapacity,
} from "./organization-paid-subscribe-seats.js";

vi.mock("./organization-billing-plan.js", () => ({
  resolveOrganizationBillingPlan: vi.fn(),
}));

vi.mock("../repositories/member.repository.js", () => ({
  memberRepository: {
    getMemberByUserIdAndOrganizationId: vi.fn(),
  },
}));

const resolveOrganizationBillingPlanMock = vi.mocked(
  resolveOrganizationBillingPlan,
);
const getMemberMock = vi.mocked(
  memberRepository.getMemberByUserIdAndOrganizationId,
);

describe("autoAssignSeatsOnPaidSubscribe", () => {
  it("assigns the owner first then oldest members up to purchased seats", async () => {
    const updateMock = vi.fn();
    const tx = {
      member: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "m-old",
            role: "member",
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            seatAssignedAt: null,
          },
          {
            id: "m-owner",
            role: "owner",
            createdAt: new Date("2026-03-01T00:00:00.000Z"),
            seatAssignedAt: null,
          },
          {
            id: "m-new",
            role: "member",
            createdAt: new Date("2026-02-01T00:00:00.000Z"),
            seatAssignedAt: null,
          },
        ]),
        update: updateMock,
      },
    };

    const newlyAssigned = await autoAssignSeatsOnPaidSubscribe(
      "org-1",
      2,
      tx as never,
    );

    assert.equal(newlyAssigned, 2);
    assert.deepEqual(
      updateMock.mock.calls.map(
        (call: [{ where: { id: string } }]) => call[0].where.id,
      ),
      ["m-owner", "m-old"],
    );
  });

  it("does not fill unused seats when some members are already seated", async () => {
    const updateMock = vi.fn();
    const tx = {
      member: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "m-seated",
            role: "member",
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            seatAssignedAt: new Date("2026-01-02T00:00:00.000Z"),
          },
          {
            id: "m-open",
            role: "member",
            createdAt: new Date("2026-01-03T00:00:00.000Z"),
            seatAssignedAt: null,
          },
        ]),
        update: updateMock,
      },
    };

    const newlyAssigned = await autoAssignSeatsOnPaidSubscribe(
      "org-1",
      5,
      tx as never,
    );

    assert.equal(newlyAssigned, 0);
    assert.equal(updateMock.mock.calls.length, 0);
  });

  it("does not unassign existing seats or exceed capacity", async () => {
    const updateMock = vi.fn();
    const tx = {
      member: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "m-owner",
            role: "owner",
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            seatAssignedAt: new Date("2026-01-02T00:00:00.000Z"),
          },
          {
            id: "m-2",
            role: "member",
            createdAt: new Date("2026-01-03T00:00:00.000Z"),
            seatAssignedAt: null,
          },
        ]),
        update: updateMock,
      },
    };

    const newlyAssigned = await autoAssignSeatsOnPaidSubscribe(
      "org-1",
      1,
      tx as never,
    );

    assert.equal(newlyAssigned, 0);
    assert.equal(updateMock.mock.calls.length, 0);
  });

  it("after first paid assign of 2, only those members stay seated", async () => {
    const assignedIds = new Set<string>();
    const updateMock = vi.fn(async ({ where }: { where: { id: string } }) => {
      assignedIds.add(where.id);
      return {};
    });
    const tx = {
      member: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "m-old",
            role: "member",
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            seatAssignedAt: null,
          },
          {
            id: "m-owner",
            role: "owner",
            createdAt: new Date("2026-03-01T00:00:00.000Z"),
            seatAssignedAt: null,
          },
          {
            id: "m-overflow",
            role: "member",
            createdAt: new Date("2026-02-01T00:00:00.000Z"),
            seatAssignedAt: null,
          },
        ]),
        update: updateMock,
      },
    };

    resolveOrganizationBillingPlanMock.mockResolvedValue({
      mode: "self_serve",
      plan: "free",
      purchasedSeats: 0,
      subscriptionId: "sub-free",
      cancelAtPeriodEnd: false,
      periodEnd: new Date("2026-09-01T00:00:00.000Z"),
    });
    getMemberMock.mockResolvedValue({ seatAssignedAt: null } as never);

    assert.equal(
      await hasAssignedOrganizationSeat("m-overflow", "org-1", {} as never),
      true,
    );

    await autoAssignSeatsOnPaidSubscribe("org-1", 2, tx as never);

    resolveOrganizationBillingPlanMock.mockResolvedValue({
      mode: "self_serve",
      plan: "starter",
      purchasedSeats: 2,
      subscriptionId: "sub-paid",
      cancelAtPeriodEnd: false,
      periodEnd: new Date("2026-09-01T00:00:00.000Z"),
    });
    getMemberMock.mockImplementation(
      async (userId: string) =>
        ({
          seatAssignedAt: assignedIds.has(userId) ? new Date() : null,
        }) as never,
    );

    assert.equal(
      await hasAssignedOrganizationSeat("m-owner", "org-1", {} as never),
      true,
    );
    assert.equal(
      await hasAssignedOrganizationSeat("m-old", "org-1", {} as never),
      true,
    );
    assert.equal(
      await hasAssignedOrganizationSeat("m-overflow", "org-1", {} as never),
      false,
    );
  });
});

describe("unassignSeatsOverPurchasedCapacity", () => {
  it("unassigns the newest seated members until assigned matches purchased seats", async () => {
    const updateMock = vi.fn();
    const tx = {
      member: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "m-oldest",
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            seatAssignedAt: new Date("2026-04-01T00:00:00.000Z"),
          },
          {
            id: "m-middle",
            createdAt: new Date("2026-02-01T00:00:00.000Z"),
            seatAssignedAt: new Date("2026-04-01T00:00:00.000Z"),
          },
          {
            id: "m-newest",
            createdAt: new Date("2026-03-01T00:00:00.000Z"),
            seatAssignedAt: new Date("2026-04-01T00:00:00.000Z"),
          },
        ]),
        update: updateMock,
      },
    };

    const unassigned = await unassignSeatsOverPurchasedCapacity(
      "org-1",
      1,
      tx as never,
    );

    assert.equal(unassigned, 2);
    assert.deepEqual(
      updateMock.mock.calls.map(
        (call: [{ where: { id: string }; data: { seatAssignedAt: null } }]) =>
          call[0].where.id,
      ),
      ["m-newest", "m-middle"],
    );
    assert.equal(updateMock.mock.calls[0]?.[0].data.seatAssignedAt, null);
  });

  it("does not keep a newer owner over an older seated member", async () => {
    const updateMock = vi.fn();
    const tx = {
      member: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "m-old-member",
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            role: "member",
            seatAssignedAt: new Date("2026-04-01T00:00:00.000Z"),
          },
          {
            id: "m-new-owner",
            createdAt: new Date("2026-03-01T00:00:00.000Z"),
            role: "owner",
            seatAssignedAt: new Date("2026-04-01T00:00:00.000Z"),
          },
        ]),
        update: updateMock,
      },
    };

    const unassigned = await unassignSeatsOverPurchasedCapacity(
      "org-1",
      1,
      tx as never,
    );

    assert.equal(unassigned, 1);
    assert.equal(updateMock.mock.calls[0]?.[0].where.id, "m-new-owner");
  });

  it("does nothing when assigned seats already fit purchased capacity", async () => {
    const updateMock = vi.fn();
    const tx = {
      member: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "m-1",
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            seatAssignedAt: new Date("2026-04-01T00:00:00.000Z"),
          },
        ]),
        update: updateMock,
      },
    };

    const unassigned = await unassignSeatsOverPurchasedCapacity(
      "org-1",
      5,
      tx as never,
    );

    assert.equal(unassigned, 0);
    assert.equal(updateMock.mock.calls.length, 0);
  });
});
