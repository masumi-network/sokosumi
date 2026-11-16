import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  revokePolarSubscription: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  writeOffUnlessLiveCuso: vi.fn(),
  prisma: {
    polarSubscription: {
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

vi.mock("@/clients/polar.client", () => ({
  revokePolarSubscription: m.revokePolarSubscription,
}));
vi.mock("@/lib/db/prisma", () => ({ default: m.prisma }));
vi.mock("@sentry/node", () => ({
  captureException: m.captureException,
  captureMessage: m.captureMessage,
}));
vi.mock("@/helpers/cuso-project-credits", () => ({
  writeOffUnlessLiveCuso: m.writeOffUnlessLiveCuso,
}));
vi.mock("@/lib/db/transaction", () => ({
  serializableTransaction: (run: (tx: unknown) => Promise<unknown>) =>
    run("tx"),
}));

import { CMO_SOKO_BOT_VERSION_IDS } from "@sokosumi/soko-bot";
import { HTTPException } from "hono/http-exception";

import {
  retryOwedPolarRevokes,
  revokeCusoSubscription,
  revokeCusoSubscriptionIfLeavingCmo,
  revokeOrganizationCusoSubscriptions,
  revokeProjectCusoSubscription,
  revokeSubscriptionsLeftByEnding,
} from "./polar-subscription-end.service";

const BOT_ID = "0190a000-0000-7000-8000-0000000000b0";
const PROJECT_ID = "0190a000-0000-7000-8000-000000000001";
const NOW = new Date("2026-11-13T12:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ now: NOW });
  m.prisma.polarSubscription.findMany.mockResolvedValue([
    { id: "row_1", polarSubscriptionId: "sub_1" },
  ]);
  m.prisma.polarSubscription.updateMany.mockResolvedValue({ count: 1 });
  m.revokePolarSubscription.mockResolvedValue(undefined);
});

describe("revokeCusoSubscription", () => {
  it("revokes the live Cuso's non-ended subscription at Polar and records the end", async () => {
    await revokeCusoSubscription(BOT_ID);

    expect(m.prisma.polarSubscription.findMany).toHaveBeenCalledWith(
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
    expect(m.prisma.polarSubscription.updateMany).toHaveBeenCalledWith({
      where: { id: "row_1", endedAt: null },
      data: { status: "canceled", endedAt: NOW, polarEventAt: NOW },
    });
    expect(m.revokePolarSubscription.mock.invocationCallOrder[0]).toBeLessThan(
      m.prisma.polarSubscription.updateMany.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("calls Polar for nothing when the Cuso has no subscription", async () => {
    m.prisma.polarSubscription.findMany.mockResolvedValue([]);

    await revokeCusoSubscription(BOT_ID);

    expect(m.revokePolarSubscription).not.toHaveBeenCalled();
    expect(m.prisma.polarSubscription.updateMany).not.toHaveBeenCalled();
  });

  it("ends the row and marks its revoke owed when Polar fails, so the ending goes on", async () => {
    m.revokePolarSubscription.mockRejectedValue(new Error("polar is down"));

    await expect(revokeCusoSubscription(BOT_ID)).resolves.toBeUndefined();

    expect(
      m.prisma.polarSubscription.updateMany,
    ).toHaveBeenCalledExactlyOnceWith({
      where: { id: "row_1", endedAt: null },
      data: { endedAt: NOW, revokeOwedAt: NOW, revokeFailures: 1 },
    });
    // The retry job reports a revoke that keeps failing; one failure is not.
    expect(m.captureException).not.toHaveBeenCalled();
  });

  it("passes on Polar's own 503 when Polar has no settings", async () => {
    m.revokePolarSubscription.mockRejectedValue(
      new HTTPException(503, { message: "Polar is not configured" }),
    );

    await expect(revokeCusoSubscription(BOT_ID)).rejects.toMatchObject({
      status: 503,
    });
    expect(m.prisma.polarSubscription.updateMany).not.toHaveBeenCalled();
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

    expect(m.prisma.polarSubscription.findMany).not.toHaveBeenCalled();
    expect(m.revokePolarSubscription).not.toHaveBeenCalled();
  });
});

describe("revokeProjectCusoSubscription", () => {
  it("revokes the subscription of a Project in the caller's workspace", async () => {
    await revokeProjectCusoSubscription(PROJECT_ID, "ws_1");

    expect(m.prisma.polarSubscription.findMany).toHaveBeenCalledWith(
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

describe("revokeOrganizationCusoSubscriptions", () => {
  it("revokes every non-ended subscription of the organization", async () => {
    m.prisma.polarSubscription.findMany.mockResolvedValue([
      { id: "row_1", polarSubscriptionId: "sub_1" },
      { id: "row_2", polarSubscriptionId: "sub_2" },
    ]);

    await revokeOrganizationCusoSubscriptions("org_1");

    // An owed revoke too: the deletion takes its mark with the row.
    expect(m.prisma.polarSubscription.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [{ endedAt: null }, { revokeOwedAt: { not: null } }],
          organizationId: "org_1",
        },
      }),
    );
    expect(m.revokePolarSubscription.mock.calls).toEqual([
      ["sub_1"],
      ["sub_2"],
    ]);
  });

  it("refuses with a 503 and leaves the row alone when Polar fails, since the deletion would drop the owed mark", async () => {
    const failure = new Error("polar is down");
    m.revokePolarSubscription.mockRejectedValue(failure);

    await expect(
      revokeOrganizationCusoSubscriptions("org_1"),
    ).rejects.toMatchObject({
      status: 503,
      message: expect.stringContaining("Nothing was changed"),
    });

    expect(m.prisma.polarSubscription.updateMany).not.toHaveBeenCalled();
    expect(m.captureException).toHaveBeenCalledWith(
      failure,
      expect.any(Object),
    );
  });
});

describe("revokeSubscriptionsLeftByEnding", () => {
  it("revokes a subscription the Project kept after its Cuso ended", async () => {
    await revokeSubscriptionsLeftByEnding(PROJECT_ID);

    expect(m.prisma.polarSubscription.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          endedAt: null,
          projectId: PROJECT_ID,
          project: {
            sokoBots: {
              none: expect.objectContaining({
                archivedAt: null,
                deletedAt: null,
              }),
            },
          },
        },
      }),
    );
    expect(m.revokePolarSubscription).toHaveBeenCalledExactlyOnceWith("sub_1");
  });

  it("marks the revoke owed and does not throw when Polar fails, since the Cuso has already ended", async () => {
    m.revokePolarSubscription.mockRejectedValue(new Error("polar is down"));

    await expect(
      revokeSubscriptionsLeftByEnding(PROJECT_ID),
    ).resolves.toBeUndefined();

    expect(m.prisma.polarSubscription.updateMany).toHaveBeenCalledWith({
      where: { id: "row_1", endedAt: null },
      data: { endedAt: NOW, revokeOwedAt: NOW, revokeFailures: 1 },
    });
  });

  it("writes off the Project's credits once it revoked one, even when Polar failed", async () => {
    await revokeSubscriptionsLeftByEnding(PROJECT_ID);
    m.revokePolarSubscription.mockRejectedValue(new Error("polar is down"));
    await revokeSubscriptionsLeftByEnding(PROJECT_ID);

    expect(m.writeOffUnlessLiveCuso.mock.calls).toEqual([
      [PROJECT_ID, "tx"],
      [PROJECT_ID, "tx"],
    ]);
  });

  it("writes off nothing when the ending left no subscription", async () => {
    m.prisma.polarSubscription.findMany.mockResolvedValue([]);

    await revokeSubscriptionsLeftByEnding(PROJECT_ID);

    expect(m.writeOffUnlessLiveCuso).not.toHaveBeenCalled();
  });

  it("looks for nothing without a Project", async () => {
    await revokeSubscriptionsLeftByEnding(null);

    expect(m.prisma.polarSubscription.findMany).not.toHaveBeenCalled();
  });
});

describe("retryOwedPolarRevokes", () => {
  const always = () => true;

  beforeEach(() => {
    m.prisma.polarSubscription.findMany.mockResolvedValue([
      { id: "row_1", polarSubscriptionId: "sub_1" },
    ]);
  });

  it("revokes each owed subscription at Polar and clears its mark", async () => {
    await expect(retryOwedPolarRevokes(always)).resolves.toEqual({
      errors: 0,
      revoked: 1,
      stoppedEarly: false,
    });

    expect(m.prisma.polarSubscription.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { revokeOwedAt: { not: null } } }),
    );
    expect(m.revokePolarSubscription).toHaveBeenCalledExactlyOnceWith("sub_1");
    expect(m.prisma.polarSubscription.updateMany).toHaveBeenCalledWith({
      where: { id: "row_1", revokeOwedAt: { not: null } },
      data: {
        status: "canceled",
        polarEventAt: NOW,
        revokeOwedAt: null,
        revokeFailures: 0,
      },
    });
  });

  it("clears a subscription Polar had revoked already", async () => {
    // The Polar client answers an already-revoked subscription as revoked.
    m.revokePolarSubscription.mockResolvedValue(undefined);

    const result = await retryOwedPolarRevokes(always);

    expect(result.errors).toBe(0);
    expect(m.prisma.polarSubscription.updateMany).toHaveBeenCalledOnce();
    expect(m.captureMessage).not.toHaveBeenCalled();
  });

  it("keeps the mark and counts the failure when Polar still fails", async () => {
    m.revokePolarSubscription.mockRejectedValue(new Error("polar is down"));
    m.prisma.polarSubscription.update.mockResolvedValue({ revokeFailures: 2 });

    await expect(retryOwedPolarRevokes(always)).resolves.toEqual({
      errors: 1,
      revoked: 0,
      stoppedEarly: false,
    });

    expect(m.prisma.polarSubscription.updateMany).not.toHaveBeenCalled();
    expect(m.prisma.polarSubscription.update).toHaveBeenCalledWith({
      where: { id: "row_1" },
      data: { revokeFailures: { increment: 1 } },
      select: { revokeFailures: true },
    });
    expect(m.captureMessage).not.toHaveBeenCalled();
  });

  it("reports a revoke once, on the run its failures reach the limit", async () => {
    m.revokePolarSubscription.mockRejectedValue(new Error("polar is down"));
    for (const revokeFailures of [5, 6, 7]) {
      m.prisma.polarSubscription.update.mockResolvedValueOnce({
        revokeFailures,
      });
      await retryOwedPolarRevokes(always);
    }

    expect(m.captureMessage).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("still owed"),
      expect.objectContaining({
        level: "error",
        extra: expect.objectContaining({ polarSubscriptionId: "sub_1" }),
      }),
    );
  });

  it("stops before Polar when the run is out of time", async () => {
    await expect(retryOwedPolarRevokes(() => false)).resolves.toEqual({
      errors: 0,
      revoked: 0,
      stoppedEarly: true,
    });
    expect(m.revokePolarSubscription).not.toHaveBeenCalled();
  });
});
