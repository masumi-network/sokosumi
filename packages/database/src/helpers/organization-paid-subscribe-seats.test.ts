import assert from "node:assert/strict";

import { describe, it, vi } from "vitest";

import { autoAssignSeatsOnPaidSubscribe } from "./organization-paid-subscribe-seats.js";

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
});
