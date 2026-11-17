import { describe, expect, it } from "vitest";

import { messageSafeErrorFields } from "@/lib/safe-error-fields";

const SUBJECT = "Confidential merger with Acme";
const KEY = "sk_live_abc123";

function leaks(fields: unknown, ...secrets: string[]) {
  const text = JSON.stringify(fields);
  return secrets.filter((secret) => text.includes(secret));
}

describe("messageSafeErrorFields", () => {
  it("keeps no text from a name, code, status or operation it cannot trust", () => {
    const error = Object.assign(new Error(`Subject: ${SUBJECT} ${KEY}`), {
      name: SUBJECT,
      code: "SecretMerger",
      status: "502",
      details: { operation: `Subject: ${SUBJECT} ${KEY}`, status: 502.5 },
    });
    expect(messageSafeErrorFields(error)).toEqual({ errorName: "Error" });
  });

  it.each([
    "MERGER_ACME",
    "SK_LIVE_ABC123",
    "AKIAIOSFODNN7EXAMPLE",
    "P9999",
    KEY,
    SUBJECT,
  ])("drops the code %s, which is not a known machine code", (code) => {
    const fields = messageSafeErrorFields(
      Object.assign(new Error("body"), { code }),
    );
    expect(fields).toEqual({ errorName: "Error" });
  });

  it.each([
    ["name", { name: KEY }],
    ["operation", { details: { operation: KEY } }],
  ])("drops a %s that carries text", (_field, props) => {
    const fields = messageSafeErrorFields(Object.assign(new Error("x"), props));
    expect(leaks(fields, "sk_live", "Confidential")).toEqual([]);
  });

  it.each(["P2002", "P2034", "P1001", "ECONNRESET", "UND_ERR_HEADERS_TIMEOUT"])(
    "keeps the known machine code %s",
    (code) => {
      expect(
        messageSafeErrorFields(Object.assign(new Error("x"), { code })),
      ).toEqual({ errorName: "Error", code });
    },
  );

  it("keeps a known error class, a known code, an HTTP status and a Core tool slug", () => {
    const error = Object.assign(new TypeError("fetch failed"), {
      code: "ECONNRESET",
      details: { operation: "GMAIL_FETCH_EMAILS", status: 502 },
    });
    expect(messageSafeErrorFields(error)).toEqual({
      errorName: "TypeError",
      code: "ECONNRESET",
      status: 502,
      operation: "GMAIL_FETCH_EMAILS",
    });
  });

  it("names anything that is not an Error by a fixed category", () => {
    expect(messageSafeErrorFields(`${SUBJECT} ${KEY}`)).toEqual({
      errorName: "Error",
    });
    expect(messageSafeErrorFields(null)).toEqual({ errorName: "Error" });
  });

  describe("an error whose properties throw when read", () => {
    const throwing = () => {
      throw new Error("getter threw");
    };
    it.each(["name", "code", "details", "status", "statusCode"])(
      "falls back to the fixed category when %s throws",
      (key) => {
        const error = Object.defineProperty(new Error("body"), key, {
          get: throwing,
        });
        expect(() => messageSafeErrorFields(error)).not.toThrow();
        expect(messageSafeErrorFields(error)).toMatchObject({
          errorName: "Error",
        });
      },
    );

    it.each(["status", "operation"])(
      "falls back when details.%s throws",
      (key) => {
        const error = Object.assign(new Error("body"), {
          details: Object.defineProperty({}, key, { get: throwing }),
        });
        expect(() => messageSafeErrorFields(error)).not.toThrow();
      },
    );

    it("falls back when the error is a proxy that throws on every read", () => {
      const error = new Proxy(new Error("body"), {
        get: throwing,
        has: throwing,
        getPrototypeOf: throwing,
      });
      expect(messageSafeErrorFields(error)).toEqual({ errorName: "Error" });
    });
  });
});
