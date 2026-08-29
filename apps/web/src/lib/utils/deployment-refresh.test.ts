import { describe, expect, it } from "vitest";

import { isStaleDeploymentError } from "@/lib/utils/deployment-refresh";

const NEXT_16_CLIENT_UNRECOGNIZED_ACTION =
  'Server Action "009d9de8d488da49c4dc1688d001bc703beae84c91" was not found on the server. \nRead more: https://nextjs.org/docs/messages/failed-to-find-server-action';

describe("isStaleDeploymentError", () => {
  it("matches Next server action-not-found wording used by onRequestError", () => {
    expect(
      isStaleDeploymentError(
        "Failed to find Server Action. This request might be from an older or newer deployment.",
      ),
    ).toBe(true);
  });

  it("matches Next 16 client UnrecognizedActionError wording (SOKOSUMI-RJ)", () => {
    expect(isStaleDeploymentError(NEXT_16_CLIENT_UNRECOGNIZED_ACTION)).toBe(
      true,
    );
  });

  it("does not match unrelated errors", () => {
    expect(
      isStaleDeploymentError("TypeError: Cannot read properties of null"),
    ).toBe(false);
  });
});
