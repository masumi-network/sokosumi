import { describe, expect, it } from "vitest";

import { getErrorName, payloadTooLarge } from "./error";

describe("payloadTooLarge", () => {
  it("creates HTTP 413 exceptions", () => {
    const error = payloadTooLarge("Request is too large");

    expect(error.status).toBe(413);
    expect(error.message).toBe("Request is too large");
  });
});

describe("getErrorName", () => {
  it("maps 413 to PayloadTooLarge", () => {
    expect(getErrorName(413)).toBe("PayloadTooLarge");
  });
});
