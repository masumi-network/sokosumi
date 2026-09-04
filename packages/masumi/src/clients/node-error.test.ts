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

  it("appends the cause undici hides behind TypeError: fetch failed", () => {
    // Every connection-level failure reaches us as this one message. Without
    // the cause, ECONNREFUSED and ENOTFOUND share a Sentry title.
    const refused = new TypeError("fetch failed", {
      cause: new Error("connect ECONNREFUSED 127.0.0.1:59999"),
    });
    expect(extractNodeErrorMessage(refused)).toBe(
      "TypeError: fetch failed: Error: connect ECONNREFUSED 127.0.0.1:59999",
    );
  });

  it("caps a long cause chain with the rest of the fallback", () => {
    const long = new TypeError("fetch failed", { cause: "x".repeat(500) });
    const dumped = extractNodeErrorMessage(long);
    expect(dumped).toHaveLength(300);
    expect(dumped).toContain("(truncated from");
  });

  it("names an information-free body instead of dumping {}", () => {
    // hey-api turns an empty error body into `{}` (finalError = finalError
    // || {}), which stringifies back to the same "{}" the timeout produced.
    expect(extractNodeErrorMessage({})).toBe("(no error detail)");
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
