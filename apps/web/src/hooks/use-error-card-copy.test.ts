import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

import {
  CoreAuthUnavailableError,
  UnAuthenticatedError,
} from "@/lib/auth/errors";

import { useErrorCardCopy } from "./use-error-card-copy";

/**
 * What a production build hands the boundary: the class, the name, the message
 * and `reason` are gone, and only the digest survives.
 */
function masked(error: Error & { digest?: string }): Error & {
  digest?: string;
} {
  const generic: Error & { digest?: string } = new Error(
    "An error occurred in the Server Components render.",
  );
  generic.digest = error.digest;
  return generic;
}

describe("useErrorCardCopy", () => {
  it("says the service is unavailable when Core could not be reached", () => {
    const { result } = renderHook(() =>
      useErrorCardCopy(masked(new CoreAuthUnavailableError("timeout"))),
    );

    expect(result.current).toEqual({
      title: "unavailableTitle",
      description: "unavailableDescription",
    });
  });

  it.each([
    ["a masked logout", masked(new UnAuthenticatedError())],
    ["a real bug", new Error("Cannot read properties of undefined")],
  ])("keeps the generic card for %s", (_case, error) => {
    // Only a Core stall earns the outage copy. Telling a user their session is
    // fine and to wait a moment would be wrong for anything else.
    const { result } = renderHook(() => useErrorCardCopy(error));

    expect(result.current).toEqual({
      title: "title",
      description: "description",
    });
  });
});
