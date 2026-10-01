import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { completeComposioAuthCallbackAction } from "@/lib/actions/composio/action";
import type { ComposioOAuthPopupFlow } from "@/lib/composio/use-composio-oauth-popup";
import { useComposioConnection } from "./use-composio-connection";

const popup = vi.hoisted(() => ({
  result: { kind: "run" } as { kind: "run" | "in_flight" | "popup_blocked" },
}));

vi.mock("@/lib/actions/composio/action", () => ({
  completeComposioAuthCallbackAction: vi.fn(),
}));

const flow = {
  navigate: vi.fn(),
  nonce: "nonce",
  waitForCallback: vi.fn(),
} satisfies ComposioOAuthPopupFlow;

vi.mock("@/lib/composio/use-composio-oauth-popup", () => ({
  useComposioOAuthPopup: () => ({
    runPopupOAuth: async (action: (f: ComposioOAuthPopupFlow) => unknown) =>
      popup.result.kind === "run"
        ? { kind: "completed", value: await action(flow) }
        : { kind: popup.result.kind },
  }),
}));

const initiate = vi.fn();
const finalize = vi.fn();

function connect() {
  const { result } = renderHook(() => useComposioConnection());
  return result.current.connect({ initiate, finalize });
}

function callback(overrides: Record<string, unknown> = {}) {
  return {
    kind: "callback",
    payload: {
      status: "success",
      connectionId: "ca_1",
      sessionUri: "https://backend.composio.dev/session/one",
      ...overrides,
    },
  };
}

describe("useComposioConnection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    popup.result = { kind: "run" };
    initiate.mockResolvedValue({
      ok: true,
      value: { connectionId: "ca_1", redirectUrl: "https://connect/link" },
    });
    flow.waitForCallback.mockResolvedValue(callback());
    vi.mocked(completeComposioAuthCallbackAction).mockResolvedValue({
      ok: true,
      value: undefined,
    });
    finalize.mockResolvedValue({ ok: true, value: { id: "final" } });
  });

  it("initiates, sends the popup on, redeems the callback and finalizes", async () => {
    await expect(connect()).resolves.toEqual({
      kind: "connected",
      value: { id: "final" },
    });

    expect(flow.navigate).toHaveBeenCalledWith("https://connect/link");
    expect(completeComposioAuthCallbackAction).toHaveBeenCalledWith({
      connectionId: "ca_1",
      sessionUri: "https://backend.composio.dev/session/one",
    });
    expect(finalize).toHaveBeenCalledWith("ca_1");
  });

  it("announces the start once the popup is open", async () => {
    const onStart = vi.fn();
    const { result } = renderHook(() => useComposioConnection());

    await result.current.connect({ initiate, finalize, onStart });

    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStart.mock.invocationCallOrder[0]).toBeLessThan(
      initiate.mock.invocationCallOrder[0],
    );
  });

  it("reports a failed initiate with its error, opening nothing", async () => {
    const error = { code: "INTERNAL_SERVER_ERROR", kind: "x" };
    initiate.mockResolvedValue({ ok: false, error });

    await expect(connect()).resolves.toEqual({
      kind: "failed",
      stage: "initiate",
      error,
    });
    expect(flow.navigate).not.toHaveBeenCalled();
  });

  it.each([
    ["cancelled", { kind: "cancelled" }],
    ["timeout", { kind: "timeout" }],
  ])("ends quietly as %s without redeeming", async (kind, wait) => {
    flow.waitForCallback.mockResolvedValue(wait);

    await expect(connect()).resolves.toEqual({ kind });
    expect(completeComposioAuthCallbackAction).not.toHaveBeenCalled();
  });

  it.each([
    [
      "a provider error",
      { status: "error", sessionUri: null },
      "provider_callback",
    ],
    [
      "another connection's callback",
      { connectionId: "ca_other" },
      "legacy_callback",
    ],
    ["a callback with no session", { sessionUri: null }, "legacy_callback"],
  ])("fails on %s before redeeming", async (_name, overrides, stage) => {
    flow.waitForCallback.mockResolvedValue(callback(overrides));

    await expect(connect()).resolves.toEqual({
      kind: "failed",
      stage,
      error: null,
    });
    expect(completeComposioAuthCallbackAction).not.toHaveBeenCalled();
    expect(finalize).not.toHaveBeenCalled();
  });

  it("fails at verify when the callback cannot be redeemed", async () => {
    const error = { code: "BAD_INPUT" };
    vi.mocked(completeComposioAuthCallbackAction).mockResolvedValue({
      ok: false,
      error,
    });

    await expect(connect()).resolves.toEqual({
      kind: "failed",
      stage: "verify",
      error,
    });
    expect(finalize).not.toHaveBeenCalled();
  });

  it("fails at finalize with its error", async () => {
    const error = { code: "INTERNAL_SERVER_ERROR" };
    finalize.mockResolvedValue({ ok: false, error });

    await expect(connect()).resolves.toEqual({
      kind: "failed",
      stage: "finalize",
      error,
    });
  });

  it("turns a thrown action into an unexpected failure", async () => {
    initiate.mockRejectedValue(new Error("network"));

    await expect(connect()).resolves.toEqual({
      kind: "failed",
      stage: "unexpected",
      error: null,
    });
  });

  it.each(["in_flight", "popup_blocked"] as const)(
    "passes %s through without calling anything",
    async (kind) => {
      popup.result = { kind };

      const onStart = vi.fn();
      const { result } = renderHook(() => useComposioConnection());

      await expect(
        result.current.connect({ initiate, finalize, onStart }),
      ).resolves.toEqual({ kind });
      expect(initiate).not.toHaveBeenCalled();
      expect(onStart).not.toHaveBeenCalled();
    },
  );
});
