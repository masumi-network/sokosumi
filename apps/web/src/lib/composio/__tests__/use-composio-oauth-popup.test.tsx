import { act, renderHook, waitFor } from "@testing-library/react";
import {
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from "vitest";

import { COMPOSIO_OAUTH_NONCE_STORAGE_KEY } from "@/lib/composio/oauth-popup-protocol";
import { useComposioOAuthPopup } from "@/lib/composio/use-composio-oauth-popup";

class MockBroadcastChannel {
  static instances: MockBroadcastChannel[] = [];

  readonly close = vi.fn();
  readonly name: string;
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(name: string) {
    this.name = name;
    MockBroadcastChannel.instances.push(this);
  }
}

const storeNonceMock = vi.fn();

let windowOpenMock: MockInstance<typeof window.open>;

describe("useComposioOAuthPopup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockBroadcastChannel.instances = [];
    vi.stubGlobal("BroadcastChannel", MockBroadcastChannel);
    vi.spyOn(crypto, "randomUUID").mockReturnValue("popup-nonce");
    windowOpenMock = vi.spyOn(window, "open");
    windowOpenMock.mockReset();
    windowOpenMock.mockReturnValue({
      closed: false,
      sessionStorage: { setItem: storeNonceMock },
      close: vi.fn(),
      focus: vi.fn(),
      location: { href: "", replace: vi.fn() },
      postMessage: vi.fn(),
    } as unknown as Window);
  });

  it("opens before the action and accepts only an exact-nonce callback", async () => {
    const { result } = renderHook(() => useComposioOAuthPopup());
    let callbackReceived = false;

    const run = result.current.runPopupOAuth(async (flow) => {
      expect(windowOpenMock).toHaveBeenCalledWith(
        "about:blank",
        "sokosumi:composio:oauth:popup-nonce",
        expect.any(String),
      );
      expect(storeNonceMock).toHaveBeenCalledWith(
        COMPOSIO_OAUTH_NONCE_STORAGE_KEY,
        "popup-nonce",
      );
      flow.navigate("https://connect.composio.dev/link-token");
      const callback = await flow.waitForCallback();
      callbackReceived = callback.kind === "callback";
      return callback;
    });
    await waitFor(() => expect(MockBroadcastChannel.instances).toHaveLength(1));

    await act(async () => {
      MockBroadcastChannel.instances[0]?.onmessage?.({
        data: {
          type: "sokosumi:composio:result",
          status: "success",
          connectionId: "ca_forged",
          sessionUri: null,
          errorMessage: null,
          nonce: "other-flow",
        },
      } as MessageEvent);
    });

    expect(callbackReceived).toBe(false);

    await act(async () => {
      MockBroadcastChannel.instances[0]?.onmessage?.({
        data: {
          type: "sokosumi:composio:result",
          status: "success",
          connectionId: "ca_123",
          sessionUri: "https://backend.composio.dev/session/single-use",
          errorMessage: null,
          nonce: "popup-nonce",
        },
      } as MessageEvent);
    });

    await expect(run).resolves.toMatchObject({
      kind: "completed",
      value: { kind: "callback" },
    });
    expect(callbackReceived).toBe(true);
    expect(MockBroadcastChannel.instances[0]?.close).toHaveBeenCalledOnce();
  });

  it("closes the popup and releases the flow when session storage is blocked", async () => {
    storeNonceMock.mockImplementationOnce(() => {
      throw new DOMException("Storage blocked", "SecurityError");
    });
    const action = vi.fn(async () => "started");
    const { result } = renderHook(() => useComposioOAuthPopup());

    await expect(result.current.runPopupOAuth(action)).rejects.toThrow(
      "Storage blocked",
    );
    expect(action).not.toHaveBeenCalled();
    expect(windowOpenMock.mock.results[0]?.value?.close).toHaveBeenCalledOnce();
    await expect(result.current.runPopupOAuth(action)).resolves.toEqual({
      kind: "completed",
      value: "started",
    });
  });

  it("rejects a parallel flow and releases the lock when an action rejects", async () => {
    const { result } = renderHook(() => useComposioOAuthPopup());

    const rejectedRun = result.current.runPopupOAuth(async () => {
      throw new Error("initiation failed");
    });
    const parallelRun = await result.current.runPopupOAuth(
      async () => "ignored",
    );

    expect(parallelRun).toEqual({ kind: "in_flight" });
    await expect(rejectedRun).rejects.toThrow("initiation failed");

    await expect(
      result.current.runPopupOAuth(async () => "next-flow"),
    ).resolves.toEqual({ kind: "completed", value: "next-flow" });
    expect(windowOpenMock).toHaveBeenCalledTimes(2);
  });
});
