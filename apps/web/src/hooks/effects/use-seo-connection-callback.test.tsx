import { act, render, waitFor } from "@testing-library/react";
import { Activity, StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SeoConnectionCallbackContext } from "@/lib/seo/connection-callback";

const mocks = vi.hoisted(() => ({
  finalize: vi.fn(),
  publish: vi.fn(),
  closeChannel: vi.fn(),
}));

vi.mock("@/lib/actions/seo-connections/action", () => ({
  finalizeSeoStatisticsAction: mocks.finalize,
}));

import { useSeoConnectionCallback } from "./use-seo-connection-callback";

const CONNECTED_RESULT = {
  ok: true as const,
  value: {
    provider: "ga4" as const,
    name: "Google Analytics",
    status: "connected" as const,
    source: "native" as const,
  },
};

function sampleContext(
  overrides: Partial<SeoConnectionCallbackContext> = {},
): SeoConnectionCallbackContext {
  return {
    provider: "ga4",
    viewerId: "owner",
    organizationId: "org",
    returnPath: "/seo?auditId=audit-1",
    connectionId: null,
    sessionUri: "session-uri-1",
    nonce: "nonce-1",
    failed: false,
    ...overrides,
  };
}

describe("useSeoConnectionCallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, "close").mockImplementation(() => {});
    vi.stubGlobal("opener", null);
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        postMessage = mocks.publish;
        close = mocks.closeChannel;
      },
    );
    mocks.finalize.mockResolvedValue(CONNECTED_RESULT);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("finalizes once under StrictMode, broadcasts completion, and closes the popup", async () => {
    const captured: {
      latest: ReturnType<typeof useSeoConnectionCallback> | null;
    } = { latest: null };
    function Probe({
      context,
    }: {
      context: SeoConnectionCallbackContext | null;
    }) {
      captured.latest = useSeoConnectionCallback(context);
      return null;
    }

    const { unmount } = render(
      <StrictMode>
        <Probe context={sampleContext()} />
      </StrictMode>,
    );

    await waitFor(() => expect(captured.latest?.connected).toBe(true));
    expect(captured.latest?.busy).toBe(false);
    expect(captured.latest?.error).toBeNull();
    expect(mocks.finalize).toHaveBeenCalledExactlyOnceWith({
      provider: "ga4",
      viewerId: "owner",
      organizationId: "org",
      sessionUri: "session-uri-1",
    });
    expect(mocks.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        nonce: "nonce-1",
        status: "success",
        sessionUri: null,
      }),
    );
    expect(mocks.closeChannel).toHaveBeenCalledOnce();
    expect(window.close).toHaveBeenCalledOnce();

    unmount();
  });

  it("ignores late completion when unmounted or hidden under Activity, and re-runs on reveal", async () => {
    const first = Promise.withResolvers<typeof CONNECTED_RESULT>();
    const second = Promise.withResolvers<typeof CONNECTED_RESULT>();
    mocks.finalize
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const captured: {
      latest: ReturnType<typeof useSeoConnectionCallback> | null;
    } = { latest: null };
    function Probe({
      context,
    }: {
      context: SeoConnectionCallbackContext | null;
    }) {
      captured.latest = useSeoConnectionCallback(context);
      return null;
    }

    const context = sampleContext();
    const { rerender, unmount } = render(
      <Activity mode="visible">
        <Probe context={context} />
      </Activity>,
    );
    expect(mocks.finalize).toHaveBeenCalledTimes(1);

    rerender(
      <Activity mode="hidden">
        <Probe context={context} />
      </Activity>,
    );

    // Resolving while hidden must not mark connected or close the window.
    await act(async () => {
      first.resolve(CONNECTED_RESULT);
      await first.promise;
    });
    expect(captured.latest?.connected).toBe(false);
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(window.close).not.toHaveBeenCalled();

    // Revealing re-runs the mount effect and completes cleanly.
    rerender(
      <Activity mode="visible">
        <Probe context={context} />
      </Activity>,
    );
    expect(mocks.finalize).toHaveBeenCalledTimes(2);
    await act(async () => {
      second.resolve(CONNECTED_RESULT);
      await second.promise;
    });
    await waitFor(() => expect(captured.latest?.connected).toBe(true));
    expect(window.close).toHaveBeenCalledOnce();

    unmount();
  });

  it("ignores late completion after unmount without broadcasting or closing the popup", async () => {
    const pending = Promise.withResolvers<typeof CONNECTED_RESULT>();
    mocks.finalize.mockReturnValueOnce(pending.promise);

    const captured: {
      latest: ReturnType<typeof useSeoConnectionCallback> | null;
    } = { latest: null };
    function Probe({
      context,
    }: {
      context: SeoConnectionCallbackContext | null;
    }) {
      captured.latest = useSeoConnectionCallback(context);
      return null;
    }

    const { unmount } = render(<Probe context={sampleContext()} />);
    expect(mocks.finalize).toHaveBeenCalledTimes(1);

    unmount();

    await act(async () => {
      pending.resolve(CONNECTED_RESULT);
      await pending.promise;
    });

    expect(captured.latest?.connected).toBe(false);
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(window.close).not.toHaveBeenCalled();
  });

  it("supports explicit retry after a temporary failure and skips invalid/failed contexts", async () => {
    mocks.finalize
      .mockResolvedValueOnce({
        ok: false,
        error: { code: "INTERNAL_SERVER_ERROR", status: 503 },
      })
      .mockResolvedValueOnce(CONNECTED_RESULT);

    const captured: {
      latest: ReturnType<typeof useSeoConnectionCallback> | null;
    } = { latest: null };
    function Probe({
      context,
    }: {
      context: SeoConnectionCallbackContext | null;
    }) {
      captured.latest = useSeoConnectionCallback(context);
      return null;
    }

    const { unmount } = render(
      <Probe context={sampleContext({ nonce: null })} />,
    );
    await waitFor(() =>
      expect(captured.latest?.error).toBe("temporarilyUnavailable"),
    );
    expect(captured.latest?.canRetry).toBe(true);

    await act(async () => {
      await captured.latest?.complete();
    });
    expect(captured.latest?.connected).toBe(true);
    expect(captured.latest?.error).toBeNull();
    unmount();

    mocks.finalize.mockClear();
    render(<Probe context={null} />);
    expect(captured.latest?.error).toBe("invalidCallback");
    expect(mocks.finalize).not.toHaveBeenCalled();
  });
});
