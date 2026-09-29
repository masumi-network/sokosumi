import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const usePathnameMock = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => usePathnameMock(),
}));

import { TelemetryBoundary } from "./telemetry-boundary";

describe("TelemetryBoundary", () => {
  beforeEach(() => {
    usePathnameMock.mockReset();
  });

  it.each(["/reset-password", "/reset-password/exchange"])(
    "blocks telemetry on %s",
    (pathname) => {
      usePathnameMock.mockReturnValue(pathname);

      render(
        <TelemetryBoundary>
          <span>telemetry</span>
        </TelemetryBoundary>,
      );

      expect(screen.queryByText("telemetry")).not.toBeInTheDocument();
    },
  );

  it("allows telemetry on other routes", () => {
    usePathnameMock.mockReturnValue("/signin");

    render(
      <TelemetryBoundary>
        <span>telemetry</span>
      </TelemetryBoundary>,
    );

    expect(screen.getByText("telemetry")).toBeInTheDocument();
  });
});
