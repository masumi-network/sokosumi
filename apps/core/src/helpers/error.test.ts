import { describe, expect, it } from "vitest";

import {
  badRequest,
  forbidden,
  getErrorName,
  notFound,
  payloadTooLarge,
  unprocessableEntity,
} from "./error";

describe("payloadTooLarge", () => {
  it("creates HTTP 413 exceptions", () => {
    const error = payloadTooLarge("Request is too large");

    expect(error.status).toBe(413);
    expect(error.message).toBe("Request is too large");
  });
});

describe("error kind metadata", () => {
  it.each([
    [badRequest, 400],
    [forbidden, 403],
    [notFound, 404],
    [unprocessableEntity, 422],
  ] as const)(
    "carries the kind in the exception cause (%#)",
    (helper, status) => {
      const error = helper("Some message", { kind: "some_kind" });

      expect(error.status).toBe(status);
      expect(error.message).toBe("Some message");
      expect(error.cause).toEqual({ kind: "some_kind" });
    },
  );

  it("leaves the cause unset without metadata", () => {
    expect(notFound("Not Found").cause).toBeUndefined();
  });
});

describe("getErrorName", () => {
  it("maps 413 to PayloadTooLarge", () => {
    expect(getErrorName(413)).toBe("PayloadTooLarge");
  });
});
