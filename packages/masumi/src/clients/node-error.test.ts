import { describe, expect, it } from "vitest";

import { extractNodeErrorMessage, readNodeErrorMessage } from "./node-error.js";

describe("extractNodeErrorMessage", () => {
  it("keeps the payment node's documented envelope message", () => {
    expect(
      extractNodeErrorMessage({
        status: "error",
        error: { message: "Unauthorized" },
      }),
    ).toBe("Unauthorized");
  });

  it("dumps a non-envelope body as JSON", () => {
    expect(extractNodeErrorMessage({ status: 521, html: true })).toBe(
      '{"status":521,"html":true}',
    );
  });

  it("does not stringify fetch TimeoutError to empty JSON", () => {
    // AbortSignal.timeout / hey-api catch: Error.name and Error.message are
    // non-enumerable, so JSON.stringify is "{}" — SOKOSUMI-CORE-2Z titles.
    const timeout = new DOMException(
      "The operation was aborted.",
      "TimeoutError",
    );
    expect(JSON.stringify(timeout)).toBe("{}");
    expect(extractNodeErrorMessage(timeout)).toBe(
      "TimeoutError: The operation was aborted.",
    );
  });
});

describe("readNodeErrorMessage", () => {
  it("returns null for a TimeoutError, which is not a node envelope", () => {
    expect(
      readNodeErrorMessage(
        new DOMException("The operation was aborted.", "TimeoutError"),
      ),
    ).toBeNull();
  });
});
