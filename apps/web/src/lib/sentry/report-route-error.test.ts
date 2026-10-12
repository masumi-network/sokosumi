import { beforeEach, describe, expect, it, vi } from "vitest";

const captureException = vi.fn();
vi.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => captureException(...args),
}));

import { CORE_AUTH_UNAVAILABLE_ERROR_DIGEST } from "@/lib/auth/errors";

import { reportRouteError, shouldReportRouteError } from "./report-route-error";

describe("reportRouteError", () => {
  beforeEach(() => {
    captureException.mockClear();
  });

  it("reports a bug and its digest to Sentry", () => {
    const error: Error & { digest?: string } = new Error("boom");
    error.digest = "abc123";

    expect(reportRouteError(error)).toBe(true);
    expect(captureException).toHaveBeenCalledWith(error, {
      extra: { digest: "abc123" },
    });
  });

  it("skips a Core stall so the card does not claim anyone was notified", () => {
    const error: Error & { digest?: string } = new Error("masked");
    error.digest = CORE_AUTH_UNAVAILABLE_ERROR_DIGEST;

    expect(shouldReportRouteError(error)).toBe(false);
    expect(reportRouteError(error)).toBe(false);
    expect(captureException).not.toHaveBeenCalled();
  });

  it("skips a stale deployment chunk error", () => {
    const error = new Error("ChunkLoadError: loading chunk failed");

    expect(reportRouteError(error)).toBe(false);
    expect(captureException).not.toHaveBeenCalled();
  });
});
