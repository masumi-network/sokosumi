import { act, render, renderHook } from "@testing-library/react";
import { Activity } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ably/realtime-channel-environment", () => ({
  getRealtimeChannelEnvironment: () => ({
    network: "Mainnet",
    vercelEnv: "production",
  }),
}));

const { ablyState, refreshMock, replaceMock } = vi.hoisted(() => {
  interface TestChannel {
    attach: ReturnType<typeof vi.fn>;
    detach: ReturnType<typeof vi.fn>;
    subscribe: ReturnType<typeof vi.fn>;
    unsubscribe: ReturnType<typeof vi.fn>;
  }

  const channels = new Map<string, TestChannel>();
  const authorize = vi.fn();
  return {
    ablyState: {
      authorize,
      channels,
      client: {
        auth: { authorize },
        channels: {
          get: (name: string) => {
            const existing = channels.get(name);
            if (existing) {
              return existing;
            }
            const channel: TestChannel = {
              attach: vi.fn(() => Promise.resolve()),
              detach: vi.fn(() => Promise.resolve()),
              subscribe: vi.fn(() => Promise.resolve()),
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

import { useCalendarRealtime } from "./use-calendar-realtime";

const USER_ID = "user_1";
const WORKSPACE_A = "11111111-1111-7111-8111-111111111111";
const WORKSPACE_B = "22222222-2222-7222-8222-222222222222";
const CALENDAR_CHANNEL_A = `calendar:workspace_${WORKSPACE_A}:user_${USER_ID}`;
const CALENDAR_CHANNEL_B = `calendar:workspace_${WORKSPACE_B}:user_${USER_ID}`;
const CONTROL_CHANNEL = `calendar_control:user_${USER_ID}`;

async function flushAsync() {
  await act(async () => {
    for (let index = 0; index < 5; index += 1) {
      await Promise.resolve();
    }
  });
}

describe("useCalendarRealtime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    ablyState.channels.clear();
    ablyState.authorize.mockResolvedValue({
      capability: JSON.stringify({
        [CALENDAR_CHANNEL_A]: ["subscribe"],
        [CALENDAR_CHANNEL_B]: ["subscribe"],
        [CONTROL_CHANNEL]: ["subscribe"],
      }),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("detaches the old workspace channel and subscribes to the new one on workspace switch", async () => {
    const onResync = vi.fn();
    const { rerender } = renderHook(
      ({ workspaceId }: { workspaceId: string }) =>
        useCalendarRealtime({
          currentUserId: USER_ID,
          workspaceId,
          onAccessRevoked: vi.fn(),
          onInvalidated: vi.fn(),
          onResync,
        }),
      { initialProps: { workspaceId: WORKSPACE_A } },
    );

    await flushAsync();
    expect(
      ablyState.channels.get(CALENDAR_CHANNEL_A)?.subscribe,
    ).toHaveBeenCalledTimes(1);
    expect(onResync).toHaveBeenCalledTimes(1);

    rerender({ workspaceId: WORKSPACE_B });
    await flushAsync();

    expect(
      ablyState.channels.get(CALENDAR_CHANNEL_A)?.unsubscribe,
    ).toHaveBeenCalledTimes(1);
    expect(
      ablyState.channels.get(CALENDAR_CHANNEL_A)?.detach,
    ).toHaveBeenCalledTimes(1);
    expect(
      ablyState.channels.get(CALENDAR_CHANNEL_B)?.subscribe,
    ).toHaveBeenCalledTimes(1);
    expect(onResync).toHaveBeenCalledTimes(2);
  });

  it("detaches on React Activity hide and resyncs on reveal", async () => {
    const onResync = vi.fn();

    function Probe() {
      useCalendarRealtime({
        currentUserId: USER_ID,
        workspaceId: WORKSPACE_A,
        onAccessRevoked: vi.fn(),
        onInvalidated: vi.fn(),
        onResync,
      });
      return null;
    }

    const { rerender } = render(
      <Activity mode="visible">
        <Probe />
      </Activity>,
    );

    await flushAsync();
    expect(
      ablyState.channels.get(CALENDAR_CHANNEL_A)?.subscribe,
    ).toHaveBeenCalledTimes(1);
    expect(onResync).toHaveBeenCalledTimes(1);

    rerender(
      <Activity mode="hidden">
        <Probe />
      </Activity>,
    );

    expect(
      ablyState.channels.get(CALENDAR_CHANNEL_A)?.unsubscribe,
    ).toHaveBeenCalledTimes(1);
    expect(
      ablyState.channels.get(CALENDAR_CHANNEL_A)?.detach,
    ).toHaveBeenCalledTimes(1);
    expect(
      ablyState.channels.get(CONTROL_CHANNEL)?.unsubscribe,
    ).toHaveBeenCalledTimes(1);

    rerender(
      <Activity mode="visible">
        <Probe />
      </Activity>,
    );

    await flushAsync();
    expect(
      ablyState.channels.get(CALENDAR_CHANNEL_A)?.subscribe,
    ).toHaveBeenCalledTimes(2);
    expect(onResync).toHaveBeenCalledTimes(2);
  });
});
