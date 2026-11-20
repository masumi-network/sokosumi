import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

import { UnAuthenticatedError } from "@/lib/auth/errors";

import { useUnAuthenticatedErrorHandler } from "./use-unauthenticated-error-handler";

/**
 * What a production build actually hands an error boundary. Next replaces the
 * thrown error with a generic one and keeps only the digest, so the name, the
 * message, the class and `redirectUrl` are all gone by the time the boundary
 * runs. See `UNAUTHENTICATED_ERROR_DIGEST`.
 */
function asProductionMasksIt(error: Error & { digest?: string }): Error & {
  digest?: string;
} {
  const masked: Error & { digest?: string } = new Error(
    "An error occurred in the Server Components render. The specific message is omitted in production builds to avoid leaking sensitive details.",
  );
  masked.digest = error.digest;
  return masked;
}

describe("useUnAuthenticatedErrorHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects a logout that production masked down to a digest", () => {
    const { result } = renderHook(() =>
      useUnAuthenticatedErrorHandler(
        asProductionMasksIt(new UnAuthenticatedError()),
      ),
    );

    expect(result.current.isUnAuthenticatedError).toBe(true);
    expect(pushMock).toHaveBeenCalledWith(
      expect.stringContaining("/signin?returnUrl="),
    );
  });

  it("redirects a logout that kept its name in development", () => {
    const { result } = renderHook(() =>
      useUnAuthenticatedErrorHandler(new UnAuthenticatedError()),
    );

    expect(result.current.isUnAuthenticatedError).toBe(true);
    expect(pushMock).toHaveBeenCalledWith(
      expect.stringContaining("/signin?returnUrl="),
    );
  });

  it("leaves any other masked failure to the error boundary", () => {
    // A Core outage is masked the same way. Sending it to /signin would read as
    // a logout to a user whose session is fine.
    const masked = asProductionMasksIt(new Error("Core is down"));
    masked.digest = "1234567890";

    const { result } = renderHook(() => useUnAuthenticatedErrorHandler(masked));

    expect(result.current.isUnAuthenticatedError).toBe(false);
    expect(pushMock).not.toHaveBeenCalled();
  });
});
