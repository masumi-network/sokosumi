import { describe, expect, it } from "vitest";

import { isStaleDeploymentError } from "@/lib/utils/deployment-refresh";

describe("isStaleDeploymentError", () => {
  it("matches Next server action-not-found wording used by onRequestError", () => {
    expect(
      isStaleDeploymentError(
        "Failed to find Server Action. This request might be from an older or newer deployment.",
      ),
    ).toBe(true);
  });

  it("matches Next 16 client UnrecognizedActionError wording (SOKOSUMI-RA)", () => {
    expect(
      isStaleDeploymentError(
        'Server Action "6037bf81a54d2d4d92cb0ee900e49ae81c9bbdd98b" was not found on the server. \nRead more: https://nextjs.org/docs/messages/failed-to-find-server-action',
      ),
    ).toBe(true);
  });

  it("does not match unrelated errors", () => {
    expect(
      isStaleDeploymentError("TypeError: Cannot read properties of null"),
    ).toBe(false);
  });
});
