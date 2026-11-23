import { render } from "@testing-library/react";
import { Activity, type RefObject } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  type ActiveComposioPopupFlow,
  useComposioOAuthPopupCleanup,
} from "./use-composio-oauth-popup-cleanup";

describe("useComposioOAuthPopupCleanup", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("cancels and closes the active popup flow and resets refs on Activity hide and unmount", () => {
    const activeFlowRef: RefObject<ActiveComposioPopupFlow | null> = {
      current: null,
    };
    const inFlightRef: RefObject<boolean> = { current: false };
    const popup: Window = window;
    const closeSpy = vi.spyOn(popup, "close").mockImplementation(() => {});

    function Probe() {
      useComposioOAuthPopupCleanup(activeFlowRef, inFlightRef);
      return null;
    }

    const { rerender, unmount } = render(
      <Activity mode="visible">
        <Probe />
      </Activity>,
    );

    const cancelWait = vi.fn();
    const flow: ActiveComposioPopupFlow = {
      cancelled: false,
      cancelWait,
      nonce: "nonce-1",
      popup,
      waitPromise: null,
    };
    activeFlowRef.current = flow;
    inFlightRef.current = true;

    rerender(
      <Activity mode="hidden">
        <Probe />
      </Activity>,
    );

    expect(flow.cancelled).toBe(true);
    expect(cancelWait).toHaveBeenCalledTimes(1);
    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(activeFlowRef.current).toBeNull();
    expect(inFlightRef.current).toBe(false);

    rerender(
      <Activity mode="visible">
        <Probe />
      </Activity>,
    );

    const secondCancelWait = vi.fn();
    const secondFlow: ActiveComposioPopupFlow = {
      cancelled: false,
      cancelWait: secondCancelWait,
      nonce: "nonce-2",
      popup,
      waitPromise: null,
    };
    activeFlowRef.current = secondFlow;
    inFlightRef.current = true;

    unmount();

    expect(secondFlow.cancelled).toBe(true);
    expect(secondCancelWait).toHaveBeenCalledTimes(1);
    expect(closeSpy).toHaveBeenCalledTimes(2);
    expect(activeFlowRef.current).toBeNull();
    expect(inFlightRef.current).toBe(false);
  });
});
