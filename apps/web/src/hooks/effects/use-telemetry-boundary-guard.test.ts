import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  isTelemetryBlockedPath,
  useTelemetryBoundaryGuard,
} from "./use-telemetry-boundary-guard";

describe("isTelemetryBlockedPath", () => {
  it.each([
    "/reset-password",
    "/reset-password/exchange",
    "/n/weekly/embed",
    "/n/weekly/embed/",
  ])("returns true for blocked path %s", (pathname) => {
    expect(isTelemetryBlockedPath(pathname)).toBe(true);
  });

  it.each([
    "/signin",
    "/forgot-password",
    "/n/weekly",
    "/n/weekly/embed/child",
  ])("returns false for allowed path %s", (pathname) => {
    expect(isTelemetryBlockedPath(pathname)).toBe(false);
  });
});

describe("useTelemetryBoundaryGuard", () => {
  const reloadMock = vi.fn();

  beforeEach(() => {
    reloadMock.mockReset();
    vi.spyOn(window.location, "reload").mockImplementation(reloadMock);
  });

  it("does not reload on a fresh blocked route", () => {
    renderHook(() => useTelemetryBoundaryGuard(true));

    expect(reloadMock).not.toHaveBeenCalled();
  });

  it("stops propagation and reloads on popstate into a blocked route after an allowed route", () => {
    window.history.replaceState(null, "", "/signin");
    const { unmount } = renderHook(() => useTelemetryBoundaryGuard(false));

    const thirdPartyListener = vi.fn();
    window.addEventListener("popstate", thirdPartyListener);
    try {
      window.history.replaceState(null, "", "/reset-password");
      window.dispatchEvent(new PopStateEvent("popstate"));

      expect(thirdPartyListener).not.toHaveBeenCalled();
      expect(reloadMock).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("popstate", thirdPartyListener);
      unmount();
    }
  });

  it("reloads once when transitioning from allowed to blocked via soft navigation", () => {
    const { rerender } = renderHook(
      ({ isBlocked }: { isBlocked: boolean }) =>
        useTelemetryBoundaryGuard(isBlocked),
      { initialProps: { isBlocked: false } },
    );

    rerender({ isBlocked: true });
    rerender({ isBlocked: true });

    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it("still blocks later analytics popstate listeners even if an earlier router listener flips isBlocked first", () => {
    window.history.replaceState(null, "", "/signin");
    let rerenderHook: ((props: { isBlocked: boolean }) => void) | undefined;

    const earlierRouterListener = () => {
      rerenderHook?.({ isBlocked: true });
    };
    window.addEventListener("popstate", earlierRouterListener);

    const { rerender, unmount } = renderHook(
      ({ isBlocked }: { isBlocked: boolean }) =>
        useTelemetryBoundaryGuard(isBlocked),
      { initialProps: { isBlocked: false } },
    );
    rerenderHook = rerender;

    const laterAnalyticsListener = vi.fn();
    window.addEventListener("popstate", laterAnalyticsListener);
    try {
      window.history.replaceState(null, "", "/reset-password");
      window.dispatchEvent(new PopStateEvent("popstate"));

      expect(laterAnalyticsListener).not.toHaveBeenCalled();
      expect(reloadMock).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("popstate", earlierRouterListener);
      window.removeEventListener("popstate", laterAnalyticsListener);
      unmount();
    }
  });

  it("cleans up the popstate listener on unmount", () => {
    window.history.replaceState(null, "", "/signin");
    const { unmount } = renderHook(() => useTelemetryBoundaryGuard(false));
    unmount();

    const thirdPartyListener = vi.fn();
    window.addEventListener("popstate", thirdPartyListener);
    try {
      window.history.replaceState(null, "", "/reset-password");
      window.dispatchEvent(new PopStateEvent("popstate"));

      expect(thirdPartyListener).toHaveBeenCalledTimes(1);
      expect(reloadMock).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("popstate", thirdPartyListener);
    }
  });
});
