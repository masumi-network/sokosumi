import { describe, expect, it } from "vitest";

import { isThirdPartyDomMutationError } from "@/lib/sentry/third-party-dom-mutation-errors";

describe("isThirdPartyDomMutationError", () => {
  it("matches Chromium removeChild errors", () => {
    expect(
      isThirdPartyDomMutationError(
        "Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node.",
      ),
    ).toBe(true);
  });

  it("matches Chromium insertBefore errors", () => {
    expect(
      isThirdPartyDomMutationError(
        "Failed to execute 'insertBefore' on 'Node': The node before which the new node is to be inserted is not a child of this node.",
      ),
    ).toBe(true);
  });

  it("matches Firefox removeChild errors", () => {
    expect(
      isThirdPartyDomMutationError(
        "Node.removeChild: The node to be removed is not a child of this node",
      ),
    ).toBe(true);
  });

  it("matches Firefox insertBefore errors", () => {
    expect(
      isThirdPartyDomMutationError(
        "Node.insertBefore: Child to insert before is not a child of this node",
      ),
    ).toBe(true);
  });

  it("does not match unrelated DOM errors", () => {
    expect(
      isThirdPartyDomMutationError(
        "Failed to execute 'appendChild' on 'Node': This node type does not support this method.",
      ),
    ).toBe(false);
  });

  it("does not match application errors", () => {
    expect(
      isThirdPartyDomMutationError("TypeError: Cannot read properties of null"),
    ).toBe(false);
  });
});
