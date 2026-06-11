import { describe, expect, it } from "vitest";

import { thirdPartyDomMutationIgnoreErrors } from "@/lib/sentry/third-party-dom-mutation-errors";

function matchesAnyPattern(message: string): boolean {
  return thirdPartyDomMutationIgnoreErrors.some((pattern) =>
    pattern.test(message),
  );
}

describe("thirdPartyDomMutationIgnoreErrors", () => {
  it("matches Chromium removeChild errors", () => {
    expect(
      matchesAnyPattern(
        "Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node.",
      ),
    ).toBe(true);
  });

  it("matches Chromium insertBefore errors", () => {
    expect(
      matchesAnyPattern(
        "Failed to execute 'insertBefore' on 'Node': The node before which the new node is to be inserted is not a child of this node.",
      ),
    ).toBe(true);
  });

  it("matches Firefox removeChild errors", () => {
    expect(
      matchesAnyPattern(
        "Node.removeChild: The node to be removed is not a child of this node",
      ),
    ).toBe(true);
  });

  it("matches Firefox insertBefore errors", () => {
    expect(
      matchesAnyPattern(
        "Node.insertBefore: Child to insert before is not a child of this node",
      ),
    ).toBe(true);
  });

  it("does not match unrelated DOM errors", () => {
    expect(
      matchesAnyPattern(
        "Failed to execute 'appendChild' on 'Node': This node type does not support this method.",
      ),
    ).toBe(false);
  });

  it("does not match application errors", () => {
    expect(matchesAnyPattern("TypeError: Cannot read properties of null")).toBe(
      false,
    );
  });
});
