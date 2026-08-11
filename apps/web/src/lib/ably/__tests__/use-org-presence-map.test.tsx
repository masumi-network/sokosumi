import { renderHook, waitFor } from "@testing-library/react";
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

function connectedHandler(): (() => void) | undefined {
  const call = ablyClient.connection.on.mock.calls.find(
    (args) => args[0] === "connected",
  );
  return call?.[1] as (() => void) | undefined;
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

    await waitFor(() => {
      expect(authorizeMock).toHaveBeenCalled();
    });

    expect(getMock).not.toHaveBeenCalledWith("presence:org_active_org");
    expect(
      channelsByName.get("presence:org_active_org")?.presence.subscribe,
    ).toBeUndefined();
  });

  it("does not attach when token capability is unparseable", async () => {
    authorizeMock.mockResolvedValue({ capability: "not-json" });

    renderHook(() => useOrgPresenceMap("active_org"));

    await waitFor(() => {
      expect(authorizeMock).toHaveBeenCalled();
    });

    expect(getMock).not.toHaveBeenCalled();
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

    await waitFor(() => {
      expect(authorizeMock).toHaveBeenCalled();
    });

    expect(getMock).not.toHaveBeenCalled();
  });

  it("re-syncs on connected after a denied grant becomes available", async () => {
    authorizeMock
      .mockResolvedValueOnce(tokenWithOrgs("other_org"))
      .mockResolvedValueOnce(tokenWithOrgs("active_org"));

    renderHook(() => useOrgPresenceMap("active_org"));

    await waitFor(() => {
      expect(authorizeMock).toHaveBeenCalledTimes(1);
    });
    expect(getMock).not.toHaveBeenCalled();

    const onConnected = connectedHandler();
    expect(onConnected).toBeTypeOf("function");
    onConnected?.();

    await waitFor(() => {
      expect(authorizeMock).toHaveBeenCalledTimes(2);
      expect(getMock).toHaveBeenCalledWith("presence:org_active_org");
      expect(
        channelFor("presence:org_active_org").presence.subscribe,
      ).toHaveBeenCalled();
    });
  });

  it("re-syncs on connected after authorize fails then succeeds", async () => {
    authorizeMock
      .mockRejectedValueOnce(new Error("token refresh failed"))
      .mockResolvedValueOnce(tokenWithOrgs("active_org"));

    renderHook(() => useOrgPresenceMap("active_org"));

    await waitFor(() => {
      expect(authorizeMock).toHaveBeenCalledTimes(1);
    });
    expect(getMock).not.toHaveBeenCalled();

    connectedHandler()?.();

    await waitFor(() => {
      expect(authorizeMock).toHaveBeenCalledTimes(2);
      expect(getMock).toHaveBeenCalledWith("presence:org_active_org");
    });
  });

  it("clears prior roster and unsubscribes when organization switches", async () => {
    let resolveOrgBAuth: ((value: unknown) => void) | undefined;
    authorizeMock
      .mockResolvedValueOnce(tokenWithOrgs("org_a"))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOrgBAuth = resolve;
          }),
      );

    channelFor("presence:org_org_a").presence.get.mockResolvedValue([
      {
        // instance id must pass isValidAblyClientInstanceId (≥8 chars pattern)
        clientId: "user_1:instanceA1",
        data: { lastActiveAt: Date.now(), visible: true },
      },
    ]);

    const { result, rerender } = renderHook(
      ({ organizationId }: { organizationId: string }) =>
        useOrgPresenceMap(organizationId),
      { initialProps: { organizationId: "org_a" } },
    );

    await waitFor(() => {
      expect(getMock).toHaveBeenCalledWith("presence:org_org_a");
      expect(result.current.size).toBeGreaterThan(0);
    });

    const orgAUnsubscribe =
      channelFor("presence:org_org_a").presence.unsubscribe;

    rerender({ organizationId: "org_b" });

    // Effect entry clears roster before the deferred org_b authorize settles.
    await waitFor(() => {
      expect(result.current.size).toBe(0);
      expect(orgAUnsubscribe).toHaveBeenCalled();
    });
    expect(getMock).not.toHaveBeenCalledWith("presence:org_org_b");

    resolveOrgBAuth?.(tokenWithOrgs("org_b"));

    await waitFor(() => {
      expect(getMock).toHaveBeenCalledWith("presence:org_org_b");
      expect(
        channelFor("presence:org_org_b").presence.subscribe,
      ).toHaveBeenCalled();
    });
  });

  it("tears down an attached channel when reconnect authorize fails", async () => {
    authorizeMock
      .mockResolvedValueOnce(tokenWithOrgs("active_org"))
      .mockRejectedValueOnce(new Error("token refresh failed"));

    const { result } = renderHook(() => useOrgPresenceMap("active_org"));

    await waitFor(() => {
      expect(getMock).toHaveBeenCalledWith("presence:org_active_org");
      expect(
        channelFor("presence:org_active_org").presence.subscribe,
      ).toHaveBeenCalled();
    });

    const channel = channelFor("presence:org_active_org");
    connectedHandler()?.();

    await waitFor(() => {
      expect(authorizeMock).toHaveBeenCalledTimes(2);
      expect(channel.presence.unsubscribe).toHaveBeenCalled();
      expect(result.current.size).toBe(0);
    });
  });
});
