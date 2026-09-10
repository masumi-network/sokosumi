import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type StateListener = () => void;

const { ablyClient, connectionListeners } = vi.hoisted(() => {
  const connectionListeners = new Set<StateListener>();
  return {
    connectionListeners,
    ablyClient: {
      connection: {
        state: "initialized" as string,
        on: (listener: StateListener) => connectionListeners.add(listener),
        off: (listener: StateListener) => connectionListeners.delete(listener),
      },
    },
  };
});

vi.mock("ably/react", () => ({ useAbly: () => ablyClient }));

import {
  getAblyConnectionHealthy,
  reportAblyAuthOk,
  setAblyConnectionHealthy,
} from "./ably-connection-health-store";
import { useAblyConnectionHealthPublisher } from "./use-ably-connection-health-publisher";

function emitConnection(state: string) {
  ablyClient.connection.state = state;
  for (const listener of connectionListeners) {
    listener();
  }
}

describe("useAblyConnectionHealthPublisher", () => {
  beforeEach(() => {
    connectionListeners.clear();
    ablyClient.connection.state = "initialized";
    setAblyConnectionHealthy(false);
  });

  it("does not mark realtime healthy on TCP connected until auth has succeeded", () => {
    renderHook(() => useAblyConnectionHealthPublisher());

    act(() => {
      emitConnection("connected");
    });
    expect(getAblyConnectionHealthy()).toBe(false);

    act(() => {
      reportAblyAuthOk(true);
    });
    expect(getAblyConnectionHealthy()).toBe(true);
  });
});
