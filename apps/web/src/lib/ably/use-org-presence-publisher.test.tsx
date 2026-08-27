import type { ChatPresenceMemberData } from "@sokosumi/utils";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ORG_PRESENCE_PUBLISH_MIN_INTERVAL_MS } from "@/lib/ably/should-publish-org-presence";

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
            update: ReturnType<typeof vi.fn>;
            enter: ReturnType<typeof vi.fn>;
            leave: ReturnType<typeof vi.fn>;
          };
          detach: ReturnType<typeof vi.fn>;
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

import { useOrgPresencePublisher } from "@/lib/ably/use-org-presence-publisher";

function channelFor(name: string) {
  let channel = channelsByName.get(name);
  if (!channel) {
    channel = {
      name,
      presence: {
        update: vi.fn().mockResolvedValue(undefined),
        enter: vi.fn().mockResolvedValue(undefined),
        leave: vi.fn().mockResolvedValue(undefined),
      },
      detach: vi.fn().mockResolvedValue(undefined),
    };
    channelsByName.set(name, channel);
  }
  return channel;
}

function tokenWithOrgs(...organizationIds: string[]) {
  const capability: Record<string, string[]> = {};
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

function setDocumentHidden(value: boolean) {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value,
  });
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useOrgPresencePublisher", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T12:00:00.000Z"));
    setDocumentHidden(false);
    authorizeMock.mockReset();
    getMock.mockReset();
    channelsByName.clear();
    ablyClient.connection.on.mockReset();
    ablyClient.connection.off.mockReset();
    getMock.mockImplementation((name: string) => channelFor(name));
    authorizeMock.mockResolvedValue(tokenWithOrgs("org_1"));
  });

  afterEach(() => {
    vi.useRealTimers();
    setDocumentHidden(false);
  });

  it("enters presence once and does not heartbeat an unchanged idle payload", async () => {
    renderHook(() => useOrgPresencePublisher("org_1"));
    await flushEffects();

    const presence = channelFor("presence:org_org_1").presence;
    expect(presence.update).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(presence.update).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ORG_PRESENCE_PUBLISH_MIN_INTERVAL_MS);
    });
    expect(presence.update).toHaveBeenCalledTimes(1);
    expect(presence.enter).not.toHaveBeenCalled();
  });

  it("does not publish activity inside the min interval, then flushes lastActiveAt", async () => {
    renderHook(() => useOrgPresencePublisher("org_1"));
    await flushEffects();

    const presence = channelFor("presence:org_org_1").presence;
    expect(presence.update).toHaveBeenCalledTimes(1);
    const firstPayload = presence.update.mock.calls[0]?.[0] as
      | ChatPresenceMemberData
      | undefined;

    await act(async () => {
      vi.setSystemTime(Date.now() + 60_000);
      window.dispatchEvent(new Event("pointerdown"));
      await Promise.resolve();
    });
    expect(presence.update).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ORG_PRESENCE_PUBLISH_MIN_INTERVAL_MS);
    });
    expect(presence.update).toHaveBeenCalledTimes(2);
    const flushed = presence.update.mock.calls[1]?.[0] as
      | ChatPresenceMemberData
      | undefined;
    if (firstPayload == null || flushed == null) {
      throw new Error("expected presence payloads");
    }
    expect(flushed.lastActiveAt).toBeGreaterThan(firstPayload.lastActiveAt);
  });

  it("flushes lastActiveAt on the first 4-min tick after a delayed enter update", async () => {
    let resolveEnterUpdate: () => void = () => undefined;
    getMock.mockImplementation((name: string) => {
      const channel = channelFor(name);
      channel.presence.update.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveEnterUpdate = resolve;
          }),
      );
      return channel;
    });

    renderHook(() => useOrgPresencePublisher("org_1"));
    await flushEffects();

    const presence = channelFor("presence:org_org_1").presence;
    expect(presence.update).toHaveBeenCalledTimes(1);
    const firstPayload = presence.update.mock.calls[0]?.[0] as
      | ChatPresenceMemberData
      | undefined;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
      resolveEnterUpdate();
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      window.dispatchEvent(new Event("pointerdown"));
      await Promise.resolve();
    });
    expect(presence.update).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        ORG_PRESENCE_PUBLISH_MIN_INTERVAL_MS - 5_000,
      );
    });
    expect(presence.update).toHaveBeenCalledTimes(2);
    const flushed = presence.update.mock.calls[1]?.[0] as
      | ChatPresenceMemberData
      | undefined;
    if (firstPayload == null || flushed == null) {
      throw new Error("expected presence payloads");
    }
    expect(flushed.lastActiveAt).toBeGreaterThan(firstPayload.lastActiveAt);
  });

  it("publishes immediately when visibility changes", async () => {
    renderHook(() => useOrgPresencePublisher("org_1"));
    await flushEffects();

    const presence = channelFor("presence:org_org_1").presence;
    expect(presence.update).toHaveBeenCalledTimes(1);

    await act(async () => {
      setDocumentHidden(true);
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });
    expect(presence.update).toHaveBeenCalledTimes(2);
    expect(presence.update.mock.calls[1]?.[0]).toMatchObject({
      visible: false,
    });
  });

  it("retries a failed active org on the next local tick instead of treating a failed enter as done", async () => {
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const failedOrg = channelFor("presence:org_org_1");
    failedOrg.presence.update.mockRejectedValue(new Error("channel denied"));
    failedOrg.presence.enter.mockRejectedValue(new Error("channel denied"));

    try {
      renderHook(() => useOrgPresencePublisher("org_1"));
      await flushEffects();

      expect(failedOrg.presence.update).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(failedOrg.presence.update).toHaveBeenCalledTimes(2);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("enters only the active organization even when the token grants more", async () => {
    authorizeMock.mockResolvedValue(tokenWithOrgs("org_1", "org_2"));
    renderHook(() => useOrgPresencePublisher("org_1"));
    await flushEffects();

    expect(getMock).toHaveBeenCalledWith("presence:org_org_1");
    expect(
      channelFor("presence:org_org_1").presence.update,
    ).toHaveBeenCalledTimes(1);
    expect(getMock).not.toHaveBeenCalledWith("presence:org_org_2");
    expect(
      channelFor("presence:org_org_2").presence.update,
    ).not.toHaveBeenCalled();
    expect(
      channelFor("presence:org_org_2").presence.enter,
    ).not.toHaveBeenCalled();
  });

  it("force-publishes on reconnect even when the payload is unchanged", async () => {
    renderHook(() => useOrgPresencePublisher("org_1"));
    await flushEffects();

    const presence = channelFor("presence:org_org_1").presence;
    expect(presence.update).toHaveBeenCalledTimes(1);

    await act(async () => {
      connectedHandler()?.();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(presence.update).toHaveBeenCalledTimes(2);
  });

  it("leaves the previous organization and enters the next on workspace switch", async () => {
    authorizeMock.mockResolvedValue(tokenWithOrgs("org_1", "org_2"));
    const { rerender } = renderHook(
      ({ organizationId }: { organizationId: string | null }) =>
        useOrgPresencePublisher(organizationId),
      { initialProps: { organizationId: "org_1" } },
    );
    await flushEffects();

    const org1 = channelFor("presence:org_org_1");
    expect(org1.presence.update).toHaveBeenCalledTimes(1);
    expect(getMock).not.toHaveBeenCalledWith("presence:org_org_2");

    rerender({ organizationId: "org_2" });
    await flushEffects();

    expect(org1.presence.leave).toHaveBeenCalled();
    expect(org1.detach).toHaveBeenCalled();
    expect(getMock).toHaveBeenCalledWith("presence:org_org_2");
    expect(
      channelFor("presence:org_org_2").presence.update,
    ).toHaveBeenCalledTimes(1);
  });

  it("does not enter presence in a personal workspace and leaves on switch", async () => {
    authorizeMock.mockResolvedValue(tokenWithOrgs("org_1"));
    const { rerender } = renderHook<void, { organizationId: string | null }>(
      ({ organizationId }) => useOrgPresencePublisher(organizationId),
      { initialProps: { organizationId: null } },
    );
    await flushEffects();

    expect(getMock).not.toHaveBeenCalled();
    expect(authorizeMock).not.toHaveBeenCalled();

    rerender({ organizationId: "org_1" });
    await flushEffects();
    const org1 = channelFor("presence:org_org_1");
    expect(org1.presence.update).toHaveBeenCalledTimes(1);

    rerender({ organizationId: null });
    await flushEffects();
    expect(org1.presence.leave).toHaveBeenCalled();
  });

  it("waits for leave to settle before re-entering the same organization", async () => {
    let resolveLeave: () => void = () => undefined;
    getMock.mockImplementation((name: string) => {
      const channel = channelFor(name);
      channel.presence.leave.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveLeave = resolve;
          }),
      );
      return channel;
    });

    const { rerender } = renderHook<void, { organizationId: string | null }>(
      ({ organizationId }) => useOrgPresencePublisher(organizationId),
      { initialProps: { organizationId: "org_1" } },
    );
    await flushEffects();

    const org1 = channelFor("presence:org_org_1");
    expect(org1.presence.update).toHaveBeenCalledTimes(1);

    rerender({ organizationId: null });
    await flushEffects();
    expect(org1.presence.leave).toHaveBeenCalledTimes(1);
    expect(org1.presence.update).toHaveBeenCalledTimes(1);

    rerender({ organizationId: "org_1" });
    await flushEffects();
    expect(org1.presence.update).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveLeave();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(org1.presence.update.mock.calls.length).toBeGreaterThan(1);
  });

  it("does not enter the previous organization if authorize resolves after a workspace switch", async () => {
    const authResolvers: Array<(value: unknown) => void> = [];
    authorizeMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          authResolvers.push(resolve);
        }),
    );

    const { rerender } = renderHook<void, { organizationId: string | null }>(
      ({ organizationId }) => useOrgPresencePublisher(organizationId),
      { initialProps: { organizationId: "org_1" } },
    );
    await flushEffects();
    expect(authResolvers).toHaveLength(1);
    expect(getMock).not.toHaveBeenCalled();

    rerender({ organizationId: "org_2" });
    await flushEffects();

    await act(async () => {
      authResolvers[0]?.(tokenWithOrgs("org_1", "org_2"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(getMock).not.toHaveBeenCalledWith("presence:org_org_1");
    expect(
      channelFor("presence:org_org_1").presence.update,
    ).not.toHaveBeenCalled();
    expect(
      channelFor("presence:org_org_1").presence.enter,
    ).not.toHaveBeenCalled();
    expect(getMock).toHaveBeenCalledWith("presence:org_org_2");
    expect(channelFor("presence:org_org_2").presence.update).toHaveBeenCalled();

    await act(async () => {
      authResolvers[1]?.(tokenWithOrgs("org_1", "org_2"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(getMock).not.toHaveBeenCalledWith("presence:org_org_1");
  });

  it("does not enter the active organization when it is not granted on the token", async () => {
    authorizeMock.mockResolvedValue(tokenWithOrgs("org_2"));
    renderHook(() => useOrgPresencePublisher("org_1"));
    await flushEffects();

    expect(getMock).not.toHaveBeenCalledWith("presence:org_org_1");
    expect(
      channelFor("presence:org_org_1").presence.update,
    ).not.toHaveBeenCalled();
    expect(
      channelFor("presence:org_org_1").presence.enter,
    ).not.toHaveBeenCalled();
  });
});
