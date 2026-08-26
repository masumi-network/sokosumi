import type { ChatPresenceMemberData } from "@sokosumi/utils";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ORG_PRESENCE_PUBLISH_MIN_INTERVAL_MS } from "../should-publish-org-presence";

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

import { useOrgPresencePublisher } from "../use-org-presence-publisher";

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
    renderHook(() => useOrgPresencePublisher());
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
    renderHook(() => useOrgPresencePublisher());
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

    renderHook(() => useOrgPresencePublisher());
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
    renderHook(() => useOrgPresencePublisher());
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

  it("retries a failed org on the next local tick instead of treating partial success as done", async () => {
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    authorizeMock.mockResolvedValue(tokenWithOrgs("org_1", "org_2"));
    const failedOrg = channelFor("presence:org_org_2");
    failedOrg.presence.update.mockRejectedValue(new Error("channel denied"));
    failedOrg.presence.enter.mockRejectedValue(new Error("channel denied"));

    try {
      renderHook(() => useOrgPresencePublisher());
      await flushEffects();

      const okOrg = channelFor("presence:org_org_1").presence;
      expect(okOrg.update).toHaveBeenCalledTimes(1);
      expect(failedOrg.presence.update).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(failedOrg.presence.update).toHaveBeenCalledTimes(2);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("force-publishes on reconnect even when the payload is unchanged", async () => {
    renderHook(() => useOrgPresencePublisher());
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
});
