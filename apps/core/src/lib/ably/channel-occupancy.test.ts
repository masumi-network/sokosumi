import { describe, expect, it, vi } from "vitest";

import { hasAppInFront } from "./channel-occupancy";

const { clientMock, envMock, getMock, statusMock } = vi.hoisted(() => ({
  clientMock: vi.fn(),
  envMock: {
    NETWORK: "Mainnet",
    VERCEL_ENV: "production" as "production" | "preview",
    VERCEL_GIT_COMMIT_REF: "main" as string | undefined,
  },
  getMock: vi.fn(),
  statusMock: vi.fn(),
}));

vi.mock("@/config/env", () => ({ getEnv: () => envMock }));

vi.mock("./client", () => ({
  getSubscribeRestClient: () => {
    clientMock();

    return {
      channels: {
        get: (...args: unknown[]) => {
          getMock(...args);
          return { status: statusMock };
        },
      },
    };
  },
}));

function occupancy(presenceMembers: number, subscribers = presenceMembers) {
  return {
    channelId: "notifications:all:user_user_123",
    status: {
      isActive: subscribers > 0,
      occupancy: { metrics: { presenceMembers, subscribers } },
    },
  };
}

describe("hasAppInFront", () => {
  it("asks the reader's own notifications channel, the one every tab and app attaches to", async () => {
    statusMock.mockResolvedValue(occupancy(1));

    await expect(hasAppInFront("user_123")).resolves.toBe(true);
    expect(getMock).toHaveBeenCalledWith("notifications:all:user_user_123");
  });

  it("reports nothing in front when nothing is attached", async () => {
    statusMock.mockResolvedValue(occupancy(0));

    await expect(hasAppInFront("user_123")).resolves.toBe(false);
  });

  it("does not count a tab that is attached but behind another", async () => {
    statusMock.mockResolvedValue(occupancy(0, 2));

    await expect(hasAppInFront("user_123")).resolves.toBe(false);
  });

  it("follows the preview channel naming, so a preview asks about its own tabs", async () => {
    envMock.VERCEL_ENV = "preview";
    envMock.VERCEL_GIT_COMMIT_REF = "feature/x";
    statusMock.mockResolvedValue(occupancy(2));

    try {
      await expect(hasAppInFront("user_123")).resolves.toBe(true);
      expect(getMock).toHaveBeenLastCalledWith(
        "notifications:preview:mainnet:branch_feature%2Fx:user_user_123",
      );
    } finally {
      envMock.VERCEL_ENV = "production";
      envMock.VERCEL_GIT_COMMIT_REF = "main";
    }
  });

  // A reader with nothing open is what this feature is for, and Ably may
  // have no channel at all for them. Nobody is present on a channel that is
  // not there, so it is an answer, not an unknown.
  it("reports nothing in front for a channel Ably does not have", async () => {
    const notFound = Object.assign(new Error("Channel does not exist"), {
      statusCode: 404,
      code: 40400,
    });
    statusMock.mockRejectedValue(notFound);

    await expect(hasAppInFront("user_123")).resolves.toBe(false);
  });

  // The `Rest` constructor refuses a key that is not `name:secret` with the
  // same 404 Ably answers for a channel it does not have, and the env schema
  // takes any non-empty string, so `.env.example`'s placeholder reaches it.
  // Read as an answer, that would report every reader as away and send every
  // email at once, with nothing in Sentry to say so.
  it("lets a key Ably will not take through, rather than reading it as nobody there", async () => {
    clientMock.mockImplementationOnce(() => {
      throw Object.assign(new Error("invalid key parameter"), {
        statusCode: 404,
        code: 40400,
      });
    });

    await expect(hasAppInFront("user_123")).rejects.toThrow(
      "invalid key parameter",
    );
  });

  it("lets an Ably refusal through, so the caller decides what an unknown costs", async () => {
    statusMock.mockRejectedValue(
      new Error("channel-metadata capability missing"),
    );

    await expect(hasAppInFront("user_123")).rejects.toThrow(
      "channel-metadata capability missing",
    );
  });
});
