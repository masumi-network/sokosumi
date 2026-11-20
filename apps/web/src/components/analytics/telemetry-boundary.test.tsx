import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const usePathnameMock = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => usePathnameMock(),
}));

import { TelemetryBoundary } from "./telemetry-boundary";

describe("TelemetryBoundary", () => {
  const reloadMock = vi.fn();

  beforeEach(() => {
    usePathnameMock.mockReset();
    reloadMock.mockReset();
    vi.spyOn(window.location, "reload").mockImplementation(reloadMock);
  });

  it.each([
    "/reset-password",
    "/reset-password/exchange",
    "/n/weekly/embed",
    "/n/weekly/embed/",
  ])("blocks telemetry on a fresh %s load without reloading", (pathname) => {
    usePathnameMock.mockReturnValue(pathname);

    render(
      <TelemetryBoundary>
        <span>telemetry</span>
      </TelemetryBoundary>,
    );

    expect(screen.queryByText("telemetry")).not.toBeInTheDocument();
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it.each([
    "/signin",
    "/n/weekly",
    "/n/weekly/archive",
    "/n/weekly/embedded",
    "/n/weekly/embed/child",
  ])("allows telemetry on %s", (pathname) => {
    usePathnameMock.mockReturnValue(pathname);

    render(
      <TelemetryBoundary>
        <span>telemetry</span>
      </TelemetryBoundary>,
    );

    expect(screen.getByText("telemetry")).toBeInTheDocument();
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it("intercepts Browser Back (popstate) from /signin to /reset-password before later analytics listeners and reloads", () => {
    usePathnameMock.mockReturnValue("/signin");
    window.history.replaceState(null, "", "/signin");

    render(
      <TelemetryBoundary>
        <span>telemetry</span>
      </TelemetryBoundary>,
    );

    const laterAnalyticsListener = vi.fn();
    window.addEventListener("popstate", laterAnalyticsListener);
    try {
      window.history.replaceState(null, "", "/reset-password");
      window.dispatchEvent(new PopStateEvent("popstate"));

      expect(laterAnalyticsListener).not.toHaveBeenCalled();
      expect(reloadMock).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("popstate", laterAnalyticsListener);
    }
  });

  it("leaves popstate alone when navigating Back between allowed routes", () => {
    usePathnameMock.mockReturnValue("/forgot-password");
    window.history.replaceState(null, "", "/forgot-password");

    render(
      <TelemetryBoundary>
        <span>telemetry</span>
      </TelemetryBoundary>,
    );

    const laterAnalyticsListener = vi.fn();
    window.addEventListener("popstate", laterAnalyticsListener);
    try {
      window.history.replaceState(null, "", "/signin");
      window.dispatchEvent(new PopStateEvent("popstate"));

      expect(laterAnalyticsListener).toHaveBeenCalledTimes(1);
      expect(reloadMock).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("popstate", laterAnalyticsListener);
    }
  });

  it.each(["/reset-password", "/n/weekly/embed"])(
    "reloads the document on soft navigation into %s after telemetry already mounted",
    (blockedPath) => {
      usePathnameMock.mockReturnValue("/signin");

      const { rerender } = render(
        <TelemetryBoundary>
          <span>telemetry</span>
        </TelemetryBoundary>,
      );

      expect(screen.getByText("telemetry")).toBeInTheDocument();

      usePathnameMock.mockReturnValue(blockedPath);
      rerender(
        <TelemetryBoundary>
          <span>telemetry</span>
        </TelemetryBoundary>,
      );

      expect(screen.queryByText("telemetry")).not.toBeInTheDocument();
      expect(reloadMock).toHaveBeenCalledTimes(1);
    },
  );
});
