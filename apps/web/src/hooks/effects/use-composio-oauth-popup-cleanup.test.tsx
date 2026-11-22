import { render } from "@testing-library/react";
import { Activity } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  type ActiveComposioPopupFlow,
  useComposioOAuthPopupCleanup,
} from "./use-composio-oauth-popup-cleanup";

describe("useComposioOAuthPopupCleanup", () => {
  it("cancels and closes the active popup flow and resets refs on Activity hide and unmount", () => {
    let exposed: ReturnType<typeof useComposioOAuthPopupCleanup> | null = null;

    function Probe() {
      exposed = useComposioOAuthPopupCleanup();
      return null;
    }

    const { rerender, unmount } = render(
      <Activity mode="visible">
        <Probe />
      </Activity>,
    );

    const cancelWait = vi.fn();
    const close = vi.fn();
    const flow: ActiveComposioPopupFlow = {
      cancelled: false,
      cancelWait,
      nonce: "nonce-1",
      popup: { close } as unknown as Window,
      waitPromise: null,
    };
    exposed!.activeFlowRef.current = flow;
    exposed!.inFlightRef.current = true;

    rerender(
      <Activity mode="hidden">
        <Probe />
      </Activity>,
    );

    expect(flow.cancelled).toBe(true);
    expect(cancelWait).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(exposed!.activeFlowRef.current).toBeNull();
    expect(exposed!.inFlightRef.current).toBe(false);

    rerender(
      <Activity mode="visible">
        <Probe />
      </Activity>,
    );

    const secondCancelWait = vi.fn();
    const secondClose = vi.fn();
    const secondFlow: ActiveComposioPopupFlow = {
      cancelled: false,
      cancelWait: secondCancelWait,
      nonce: "nonce-2",
      popup: { close: secondClose } as unknown as Window,
      waitPromise: null,
    };
    exposed!.activeFlowRef.current = secondFlow;
    exposed!.inFlightRef.current = true;

    unmount();

    expect(secondFlow.cancelled).toBe(true);
    expect(secondCancelWait).toHaveBeenCalledTimes(1);
    expect(secondClose).toHaveBeenCalledTimes(1);
    expect(exposed!.activeFlowRef.current).toBeNull();
    expect(exposed!.inFlightRef.current).toBe(false);
  });
});
