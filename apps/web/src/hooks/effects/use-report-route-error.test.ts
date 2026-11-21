import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  hasDeploymentRefreshGuardMock,
  isStaleDeploymentErrorMock,
  performDeploymentRefreshMock,
  reportRouteErrorMock,
} = vi.hoisted(() => ({
  hasDeploymentRefreshGuardMock: vi.fn(() => false),
  isStaleDeploymentErrorMock: vi.fn(() => false),
  performDeploymentRefreshMock: vi.fn(),
  reportRouteErrorMock: vi.fn(),
}));

vi.mock("@/lib/sentry/report-route-error", () => ({
  reportRouteError: reportRouteErrorMock,
}));

vi.mock("@/lib/utils/deployment-refresh", () => ({
  hasDeploymentRefreshGuard: hasDeploymentRefreshGuardMock,
  isStaleDeploymentError: isStaleDeploymentErrorMock,
  performDeploymentRefresh: performDeploymentRefreshMock,
}));

import {
  useGlobalRouteError,
  useReportRouteError,
} from "./use-report-route-error";

describe("useReportRouteError", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports the route error on mount and when the error instance changes", () => {
    const first = new Error("first");
    const second = new Error("second");

    const { rerender } = renderHook(
      ({ error }: { error: Error & { digest?: string } }) =>
        useReportRouteError(error),
      { initialProps: { error: first } },
    );

    expect(reportRouteErrorMock).toHaveBeenCalledTimes(1);
    expect(reportRouteErrorMock).toHaveBeenLastCalledWith(first);

    rerender({ error: first });
    expect(reportRouteErrorMock).toHaveBeenCalledTimes(1);

    rerender({ error: second });
    expect(reportRouteErrorMock).toHaveBeenCalledTimes(2);
    expect(reportRouteErrorMock).toHaveBeenLastCalledWith(second);
  });
});

describe("useGlobalRouteError", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    isStaleDeploymentErrorMock.mockReturnValue(false);
    hasDeploymentRefreshGuardMock.mockReturnValue(false);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("refreshes without reporting when a stale deployment error has no refresh guard", () => {
    isStaleDeploymentErrorMock.mockReturnValue(true);
    hasDeploymentRefreshGuardMock.mockReturnValue(false);
    const error = new Error("Failed to find Server Action");

    const { result } = renderHook(() => useGlobalRouteError(error));

    expect(performDeploymentRefreshMock).toHaveBeenCalledTimes(1);
    expect(reportRouteErrorMock).not.toHaveBeenCalled();

    act(() => {
      vi.runAllTimers();
    });
    expect(result.current).toBe(false);
  });

  it("reports the error and reveals the fallback on the next tick when not refreshing", () => {
    const error = new Error("boom");

    const { result } = renderHook(() => useGlobalRouteError(error));

    expect(performDeploymentRefreshMock).not.toHaveBeenCalled();
    expect(reportRouteErrorMock).toHaveBeenCalledExactlyOnceWith(error);
    expect(result.current).toBe(false);

    act(() => {
      vi.runAllTimers();
    });
    expect(result.current).toBe(true);
  });

  it("cancels the fallback reveal timer on unmount", () => {
    const error = new Error("boom");

    const { unmount } = renderHook(() => useGlobalRouteError(error));
    unmount();

    act(() => {
      vi.runAllTimers();
    });
    expect(reportRouteErrorMock).toHaveBeenCalledTimes(1);
  });
});
