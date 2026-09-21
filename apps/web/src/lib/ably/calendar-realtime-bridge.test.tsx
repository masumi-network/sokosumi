import { act, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { ablyState, refreshMock, replaceMock } = vi.hoisted(() => {
  interface TestChannel {
    attach: ReturnType<typeof vi.fn>;
    detach: ReturnType<typeof vi.fn>;
    subscribe: ReturnType<typeof vi.fn>;
    unsubscribe: ReturnType<typeof vi.fn>;
  }

  const channels = new Map<string, TestChannel>();
  const attachResults = new Map<string, Promise<unknown>>();
  const subscribeResults = new Map<string, Promise<unknown>>();
  const authorize = vi.fn();
  return {
    ablyState: {
      attachResults,
      authorize,
      channels,
      subscribeResults,
      client: {
        auth: { authorize },
        channels: {
          get: (name: string) => {
            const existing = channels.get(name);
            if (existing) {
              return existing;
            }
            const channel = {
              attach: vi.fn(() => attachResults.get(name) ?? Promise.resolve()),
              detach: vi.fn(() => Promise.resolve()),
              subscribe: vi.fn(
                () => subscribeResults.get(name) ?? Promise.resolve(),
              ),
              unsubscribe: vi.fn(),
            };
            channels.set(name, channel);
            return channel;
          },
        },
        connection: {
          state: "connected",
          on: vi.fn(),
          off: vi.fn(),
        },
      },
    },
    refreshMock: vi.fn(),
    replaceMock: vi.fn(),
  };
});

vi.mock("ably/react", () => ({
  useAbly: () => ablyState.client,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, replace: replaceMock }),
}));

vi.mock("@/contexts/lazy-ably-provider", () => ({
  default: ({ children }: { children: ReactNode }) => children,
}));

import { CalendarRealtimeBridge } from "./calendar-realtime-bridge";

const WORKSPACE_ID = "11111111-1111-7111-8111-111111111111";
const USER_ID = "user_1";
const CALENDAR_CHANNEL = `calendar:workspace_${WORKSPACE_ID}:user_${USER_ID}`;
const CONTROL_CHANNEL = `calendar_control:user_${USER_ID}`;

function eventHandler(channelName: string, eventName: string) {
  const channel = ablyState.channels.get(channelName);
  const call = channel?.subscribe.mock.calls.find(
    ([subscribedEvent]) => subscribedEvent === eventName,
  );
  return call?.[1] as ((message: { data: unknown }) => void) | undefined;
}

async function flushAuthorization() {
  await act(async () => {
    for (let index = 0; index < 5; index += 1) {
      await Promise.resolve();
    }
  });
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("CalendarRealtimeBridge", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    ablyState.channels.clear();
    ablyState.attachResults.clear();
    ablyState.subscribeResults.clear();
    ablyState.authorize.mockResolvedValue({
      capability: JSON.stringify({
        [CALENDAR_CHANNEL]: ["subscribe"],
        [CONTROL_CHANNEL]: ["subscribe"],
      }),
    });
  });

  it("authorizes before subscribing to the active workspace channel", async () => {
    const onResync = vi.fn();
    render(
      <CalendarRealtimeBridge
        currentUserId={USER_ID}
        workspaceId={WORKSPACE_ID}
        onInvalidated={vi.fn()}
        onAccessRevoked={vi.fn()}
        onResync={onResync}
      />,
    );

    expect([...ablyState.channels.keys()]).toEqual([
      CALENDAR_CHANNEL,
      CONTROL_CHANNEL,
    ]);
    expect(
      ablyState.channels.get(CALENDAR_CHANNEL)?.subscribe,
    ).not.toHaveBeenCalled();

    await flushAuthorization();

    expect(ablyState.authorize).toHaveBeenCalledOnce();
    expect(
      ablyState.channels.get(CALENDAR_CHANNEL)?.subscribe,
    ).toHaveBeenCalledWith("calendar_invalidated", expect.any(Function));
    expect(
      ablyState.channels.get(CONTROL_CHANNEL)?.subscribe,
    ).toHaveBeenCalledWith("calendar_access_revoked", expect.any(Function));
    expect(onResync).toHaveBeenCalledOnce();
    expect(refreshMock).toHaveBeenCalledOnce();
  });

  it("closes subscription gaps before authorization and refresh", async () => {
    const controlAttached = deferred();
    const calendarAttached = deferred();
    const onResync = vi.fn();
    ablyState.subscribeResults.set(CONTROL_CHANNEL, controlAttached.promise);
    ablyState.subscribeResults.set(CALENDAR_CHANNEL, calendarAttached.promise);

    render(
      <CalendarRealtimeBridge
        currentUserId={USER_ID}
        workspaceId={WORKSPACE_ID}
        onInvalidated={vi.fn()}
        onAccessRevoked={vi.fn()}
        onResync={onResync}
      />,
    );

    expect(ablyState.authorize).not.toHaveBeenCalled();

    controlAttached.resolve();
    await flushAuthorization();

    expect(ablyState.authorize).toHaveBeenCalledOnce();
    expect(
      ablyState.channels.get(CALENDAR_CHANNEL)?.subscribe,
    ).toHaveBeenCalledOnce();
    expect(onResync).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();

    calendarAttached.resolve();
    await flushAuthorization();

    expect(onResync).toHaveBeenCalledOnce();
    expect(refreshMock).toHaveBeenCalledOnce();

    const controlReattached = deferred();
    const calendarReattached = deferred();
    ablyState.attachResults.set(CONTROL_CHANNEL, controlReattached.promise);
    ablyState.attachResults.set(CALENDAR_CHANNEL, calendarReattached.promise);

    window.dispatchEvent(new Event("focus"));

    expect(
      ablyState.channels.get(CONTROL_CHANNEL)?.attach,
    ).toHaveBeenCalledOnce();
    expect(ablyState.authorize).toHaveBeenCalledOnce();

    controlReattached.resolve();
    await flushAuthorization();

    expect(ablyState.authorize).toHaveBeenCalledTimes(2);
    expect(
      ablyState.channels.get(CALENDAR_CHANNEL)?.attach,
    ).toHaveBeenCalledOnce();
    expect(onResync).toHaveBeenCalledOnce();
    expect(refreshMock).toHaveBeenCalledOnce();

    calendarReattached.resolve();
    await flushAuthorization();

    expect(onResync).toHaveBeenCalledTimes(2);
    expect(refreshMock).toHaveBeenCalledTimes(2);
  });

  it("coalesces a burst of committed invalidations into one refresh", async () => {
    const onResync = vi.fn();
    const onInvalidated = vi.fn();
    render(
      <CalendarRealtimeBridge
        currentUserId={USER_ID}
        workspaceId={WORKSPACE_ID}
        onInvalidated={onInvalidated}
        onAccessRevoked={vi.fn()}
        onResync={onResync}
      />,
    );
    await flushAuthorization();
    const handleInvalidated = eventHandler(
      CALENDAR_CHANNEL,
      "calendar_invalidated",
    );

    act(() => {
      handleInvalidated?.({
        data: {
          id: "invalidation_1",
          workspaceId: WORKSPACE_ID,
          projectId: null,
          calendarRevision: 4,
          payload: {},
        },
      });
      handleInvalidated?.({
        data: {
          id: "invalidation_2",
          workspaceId: WORKSPACE_ID,
          projectId: "project_1",
          calendarRevision: 5,
          payload: {},
        },
      });
      // Both invalidations cancel stale requests without resetting editors.
      expect(onInvalidated).toHaveBeenCalledTimes(2);
      expect(onResync).toHaveBeenCalledOnce();
      expect(refreshMock).toHaveBeenCalledOnce();
      vi.runAllTimers();
    });

    expect(refreshMock).toHaveBeenCalledTimes(2);
  });

  it("detaches and clears workspace state before redirecting on access loss", async () => {
    const onAccessRevoked = vi.fn();
    render(
      <CalendarRealtimeBridge
        currentUserId={USER_ID}
        workspaceId={WORKSPACE_ID}
        onInvalidated={vi.fn()}
        onAccessRevoked={onAccessRevoked}
        onResync={vi.fn()}
      />,
    );
    await flushAuthorization();
    const handleRevoked = eventHandler(
      CONTROL_CHANNEL,
      "calendar_access_revoked",
    );
    ablyState.authorize.mockResolvedValueOnce({
      capability: JSON.stringify({ [CONTROL_CHANNEL]: ["subscribe"] }),
    });

    act(() => {
      handleRevoked?.({
        data: {
          workspaceId: WORKSPACE_ID,
          organizationId: "org_1",
          at: "2026-09-14T12:00:00.000Z",
        },
      });
    });
    await flushAuthorization();

    const calendarChannel = ablyState.channels.get(CALENDAR_CHANNEL);
    expect(calendarChannel?.unsubscribe).toHaveBeenCalledWith(
      "calendar_invalidated",
      expect.any(Function),
    );
    expect(calendarChannel?.detach).toHaveBeenCalledOnce();
    expect(onAccessRevoked).toHaveBeenCalledOnce();
    expect(replaceMock).toHaveBeenCalledWith("/");
    expect(refreshMock).toHaveBeenCalledTimes(2);
    expect(ablyState.authorize).toHaveBeenCalledTimes(2);
  });

  it("keeps a rejoined workspace when a delayed revoke arrives", async () => {
    const onAccessRevoked = vi.fn();
    const onResync = vi.fn();
    render(
      <CalendarRealtimeBridge
        currentUserId={USER_ID}
        workspaceId={WORKSPACE_ID}
        onInvalidated={vi.fn()}
        onAccessRevoked={onAccessRevoked}
        onResync={onResync}
      />,
    );
    await flushAuthorization();

    act(() => {
      eventHandler(
        CONTROL_CHANNEL,
        "calendar_access_revoked",
      )?.({
        data: {
          workspaceId: WORKSPACE_ID,
          organizationId: "org_1",
          at: "2026-09-14T12:00:00.000Z",
        },
      });
    });
    await flushAuthorization();

    expect(ablyState.authorize).toHaveBeenCalledTimes(2);
    expect(onAccessRevoked).not.toHaveBeenCalled();
    expect(replaceMock).not.toHaveBeenCalled();
    expect(onResync).toHaveBeenCalledTimes(2);
    expect(refreshMock).toHaveBeenCalledTimes(2);
  });

  it("refreshes capabilities when access to an inactive workspace changes", async () => {
    const onAccessRevoked = vi.fn();
    const otherWorkspaceId = "22222222-2222-7222-8222-222222222222";
    render(
      <CalendarRealtimeBridge
        currentUserId={USER_ID}
        workspaceId={WORKSPACE_ID}
        onInvalidated={vi.fn()}
        onAccessRevoked={onAccessRevoked}
        onResync={vi.fn()}
      />,
    );
    await flushAuthorization();

    act(() => {
      eventHandler(
        CONTROL_CHANNEL,
        "calendar_access_revoked",
      )?.({
        data: {
          workspaceId: otherWorkspaceId,
          organizationId: "org_2",
          at: "2026-09-14T12:00:00.000Z",
        },
      });
    });

    expect(onAccessRevoked).not.toHaveBeenCalled();
    expect(replaceMock).not.toHaveBeenCalled();
    await flushAuthorization();
    expect(ablyState.authorize).toHaveBeenCalledTimes(2);
  });

  it("resyncs on focus and treats a removed channel grant as missed revocation", async () => {
    const onAccessRevoked = vi.fn();
    const onResync = vi.fn();
    render(
      <CalendarRealtimeBridge
        currentUserId={USER_ID}
        workspaceId={WORKSPACE_ID}
        onInvalidated={vi.fn()}
        onAccessRevoked={onAccessRevoked}
        onResync={onResync}
      />,
    );
    await flushAuthorization();

    ablyState.authorize.mockResolvedValueOnce({
      capability: JSON.stringify({ [CONTROL_CHANNEL]: ["subscribe"] }),
    });
    window.dispatchEvent(new Event("focus"));
    await flushAuthorization();

    expect(onResync).toHaveBeenCalledOnce();
    expect(onAccessRevoked).toHaveBeenCalledOnce();
    expect(replaceMock).toHaveBeenCalledWith("/");
  });
});
