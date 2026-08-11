import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { authorizeMock, getMock, channelsByName, ablyClient } = vi.hoisted(
  () => {
    const authorize = vi.fn();
    const get = vi.fn();
    return {
      authorizeMock: authorize,
      getMock: get,
      channelsByName: new Map<
        string,
        {
          name: string;
          presence: {
            subscribe: ReturnType<typeof vi.fn>;
            unsubscribe: ReturnType<typeof vi.fn>;
            get: ReturnType<typeof vi.fn>;
          };
        }
      >(),
      ablyClient: {
        auth: { authorize },
        channels: { get },
        connection: {
          on: vi.fn(),
          off: vi.fn(),
        },
      },
    };
  },
);

vi.mock("ably/react", () => ({
  useAbly: () => ablyClient,
}));

import { useOrgPresenceMap } from "../use-org-presence-map";

function channelFor(name: string) {
  let channel = channelsByName.get(name);
  if (!channel) {
    channel = {
      name,
      presence: {
        subscribe: vi.fn(),
        unsubscribe: vi.fn(),
        get: vi.fn().mockResolvedValue([]),
      },
    };
    channelsByName.set(name, channel);
  }
  return channel;
}

function tokenWithOrgs(...organizationIds: string[]) {
  const capability: Record<string, string[]> = {
    "tasks:all:user_1": ["subscribe"],
  };
  for (const organizationId of organizationIds) {
    capability[`presence:org_${organizationId}`] = ["presence", "subscribe"];
  }
  return { capability: JSON.stringify(capability) };
}

describe("useOrgPresenceMap", () => {
  beforeEach(() => {
    authorizeMock.mockReset();
    getMock.mockReset();
    channelsByName.clear();
    ablyClient.connection.on.mockReset();
    ablyClient.connection.off.mockReset();
    getMock.mockImplementation((name: string) => channelFor(name));
  });

  /**
   * SOKOSUMI-R0: attaching `presence:org_*` without that channel on the token
   * yields Ably "Channel denied access based on given capability" as an
   * unhandledrejection. Map must gate on token capability (same as publisher).
   */
  it("does not attach when active org is missing from token capability", async () => {
    authorizeMock.mockResolvedValue(tokenWithOrgs("other_org"));

    renderHook(() => useOrgPresenceMap("active_org"));

    await act(async () => {
      await Promise.resolve();
    });

    // Bug signal (red before fix): map attached active org without a grant.
    expect(getMock).not.toHaveBeenCalledWith("presence:org_active_org");
    expect(
      channelsByName.get("presence:org_active_org")?.presence.subscribe,
    ).toBeUndefined();
  });

  it("subscribes after authorize when token grants the active org", async () => {
    authorizeMock.mockResolvedValue(tokenWithOrgs("active_org"));

    renderHook(() => useOrgPresenceMap("active_org"));

    await waitFor(() => {
      expect(authorizeMock).toHaveBeenCalled();
      expect(getMock).toHaveBeenCalledWith("presence:org_active_org");
      expect(
        channelFor("presence:org_active_org").presence.subscribe,
      ).toHaveBeenCalled();
      expect(
        channelFor("presence:org_active_org").presence.get,
      ).toHaveBeenCalled();
    });
  });

  it("does not attach when authorize fails", async () => {
    authorizeMock.mockRejectedValue(new Error("token refresh failed"));

    renderHook(() => useOrgPresenceMap("active_org"));

    await act(async () => {
      await Promise.resolve();
    });

    expect(getMock).not.toHaveBeenCalled();
  });
});
