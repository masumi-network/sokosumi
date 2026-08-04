import { beforeEach, describe, expect, it, vi } from "vitest";

const { unstableRethrowMock } = vi.hoisted(() => ({
  unstableRethrowMock: vi.fn((error: unknown) => {
    if (
      typeof error === "object" &&
      error !== null &&
      "digest" in error &&
      typeof (error as { digest: unknown }).digest === "string" &&
      (error as { digest: string }).digest.startsWith("NEXT_REDIRECT")
    ) {
      throw error;
    }
  }),
}));

vi.mock("next/navigation", () => ({
  unstable_rethrow: unstableRethrowMock,
}));

import { CoreApiRequestError } from "@/lib/clients/core.client";
import { actionErrorMessage } from "../action-error-message";

describe("actionErrorMessage", () => {
  beforeEach(() => {
    unstableRethrowMock.mockClear();
  });

  it("rethrows redirect-like errors via unstable_rethrow", () => {
    const redirectError = Object.assign(new Error("NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT;replace;/signin;307;",
    });

    expect(() => actionErrorMessage(redirectError, "fallback")).toThrow(
      redirectError,
    );
    expect(unstableRethrowMock).toHaveBeenCalledWith(redirectError);
  });

  it("returns CoreApiRequestError permission message for 403", () => {
    const message =
      "Only the channel creator or an organization owner/admin can update members";

    expect(
      actionErrorMessage(
        new CoreApiRequestError(message, { status: 403 }),
        "Could not update channel.",
      ),
    ).toBe(message);
    expect(unstableRethrowMock).toHaveBeenCalled();
  });
});
