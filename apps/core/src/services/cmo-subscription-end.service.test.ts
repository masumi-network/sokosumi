import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  revokePolarSubscription: vi.fn(),
  captureException: vi.fn(),
  prisma: {
    cmoSubscription: { findMany: vi.fn(), updateMany: vi.fn() },
  },
}));

vi.mock("@/clients/polar.client", () => ({
  revokePolarSubscription: m.revokePolarSubscription,
}));
vi.mock("@/lib/db/prisma", () => ({ default: m.prisma }));
vi.mock("@sentry/node", () => ({ captureException: m.captureException }));

import { CMO_SOKO_BOT_VERSION_IDS } from "@sokosumi/soko-bot";

import {
  revokeCusoSubscription,
  revokeCusoSubscriptionIfLeavingCmo,
  revokeProjectCusoSubscription,
} from "./cmo-subscription-end.service";

const BOT_ID = "0190a000-0000-7000-8000-0000000000b0";
const PROJECT_ID = "0190a000-0000-7000-8000-000000000001";
const NOW = new Date("2026-11-13T12:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ now: NOW });
  m.prisma.cmoSubscription.findMany.mockResolvedValue([
    { id: "row_1", polarSubscriptionId: "sub_1" },
  ]);
  m.prisma.cmoSubscription.updateMany.mockResolvedValue({ count: 1 });
  m.revokePolarSubscription.mockResolvedValue(undefined);
});

describe("revokeCusoSubscription", () => {
  it("revokes the live Cuso's non-ended subscription at Polar and records the end", async () => {
    await revokeCusoSubscription(BOT_ID);

    expect(m.prisma.cmoSubscription.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          endedAt: null,
          project: {
            sokoBots: {
              some: expect.objectContaining({
                id: BOT_ID,
                archivedAt: null,
                deletedAt: null,
              }),
            },
          },
        },
      }),
    );
    expect(m.revokePolarSubscription).toHaveBeenCalledExactlyOnceWith("sub_1");
    expect(m.prisma.cmoSubscription.updateMany).toHaveBeenCalledWith({
      where: { id: "row_1", endedAt: null },
      data: { status: "canceled", endedAt: NOW, polarEventAt: NOW },
    });
    expect(m.revokePolarSubscription.mock.invocationCallOrder[0]).toBeLessThan(
      m.prisma.cmoSubscription.updateMany.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("calls Polar for nothing when the Cuso has no subscription", async () => {
    m.prisma.cmoSubscription.findMany.mockResolvedValue([]);

    await revokeCusoSubscription(BOT_ID);

    expect(m.revokePolarSubscription).not.toHaveBeenCalled();
    expect(m.prisma.cmoSubscription.updateMany).not.toHaveBeenCalled();
  });

  it("refuses with a 503 and leaves the row alone when Polar fails", async () => {
    const failure = new Error("polar is down");
    m.revokePolarSubscription.mockRejectedValue(failure);

    await expect(revokeCusoSubscription(BOT_ID)).rejects.toMatchObject({
      status: 503,
      message: expect.stringContaining("Nothing was changed"),
    });

    expect(m.prisma.cmoSubscription.updateMany).not.toHaveBeenCalled();
    expect(m.captureException).toHaveBeenCalledWith(
      failure,
      expect.any(Object),
    );
  });
});

describe("revokeCusoSubscriptionIfLeavingCmo", () => {
  it("revokes for a version outside CMO", async () => {
    await revokeCusoSubscriptionIfLeavingCmo(BOT_ID, "v16");

    expect(m.revokePolarSubscription).toHaveBeenCalledExactlyOnceWith("sub_1");
  });

  it("keeps the subscription for a move between CMO versions", async () => {
    await revokeCusoSubscriptionIfLeavingCmo(
      BOT_ID,
      CMO_SOKO_BOT_VERSION_IDS[0] as string,
    );

    expect(m.prisma.cmoSubscription.findMany).not.toHaveBeenCalled();
    expect(m.revokePolarSubscription).not.toHaveBeenCalled();
  });
});

describe("revokeProjectCusoSubscription", () => {
  it("revokes the subscription of a Project in the caller's workspace", async () => {
    await revokeProjectCusoSubscription(PROJECT_ID, "ws_1");

    expect(m.prisma.cmoSubscription.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          endedAt: null,
          projectId: PROJECT_ID,
          project: { workspaceId: "ws_1" },
        },
      }),
    );
    expect(m.revokePolarSubscription).toHaveBeenCalledExactlyOnceWith("sub_1");
  });
});
