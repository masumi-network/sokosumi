import {
  APICallError,
  JSONParseError,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  RetryError,
  TypeValidationError,
} from "ai";
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

  it.each([
    [
      "AI_APICallError",
      new APICallError({
        message: `Gmail said: Re: ${SUBJECT}`,
        url: "https://example.com/model",
        requestBodyValues: { prompt: `${SUBJECT} ${KEY}` },
        responseBody: `${SUBJECT} ${KEY}`,
        statusCode: 403,
      }),
      { status: 403 },
    ],
    [
      "AI_RetryError",
      new RetryError({
        message: `${SUBJECT} ${KEY}`,
        reason: "maxRetriesExceeded",
        errors: [new Error(KEY)],
      }),
      {},
    ],
    [
      "AI_NoObjectGeneratedError",
      new NoObjectGeneratedError({
        message: `${SUBJECT} ${KEY}`,
        text: `${SUBJECT} ${KEY}`,
        response: { id: "r", timestamp: new Date(0), modelId: "m" },
        usage: {} as never,
        finishReason: "stop",
      }),
      {},
    ],
    [
      "AI_NoOutputGeneratedError",
      new NoOutputGeneratedError({ message: `${SUBJECT} ${KEY}` }),
      {},
    ],
    [
      "AI_TypeValidationError",
      new TypeValidationError({ value: KEY, cause: new Error(SUBJECT) }),
      {},
    ],
    [
      "AI_JSONParseError",
      new JSONParseError({ text: KEY, cause: new Error(SUBJECT) }),
      {},
    ],
  ])(
    "keeps the AI SDK's %s category and status, never its text",
    (errorName, error, kept) => {
      const fields = messageSafeErrorFields(error);
      expect(fields).toEqual({ errorName, ...kept });
      expect(leaks(fields, "sk_live", "Confidential")).toEqual([]);
    },
  );

  it("keeps a Prisma class, its code and an HTTP status, never the message", () => {
    const error = Object.assign(new Error(`Gmail said: Re: ${SUBJECT}`), {
      name: "PrismaClientKnownRequestError",
      statusCode: 404,
      code: "P2025",
    });
    expect(messageSafeErrorFields(error)).toEqual({
      errorName: "PrismaClientKnownRequestError",
      status: 404,
      code: "P2025",
    });
  });

  describe("an error that wraps another through cause", () => {
    it("keeps the known code and status beneath a wrapper, never its text", () => {
      const prismaError = Object.assign(
        new Error(`Transaction failed: name "${SUBJECT}"`),
        { name: "PrismaClientKnownRequestError", code: "P2028" },
      );
      const wrapper = new Error("Scheduled work could not be closed", {
        cause: new Error(`release ${SUBJECT}`, { cause: prismaError }),
      });
      wrapper.name = "ProjectCloseScheduleError";

      const fields = messageSafeErrorFields(wrapper);

      expect(fields).toEqual({
        errorName: "ProjectCloseScheduleError",
        code: "P2028",
      });
      expect(JSON.stringify(fields)).not.toContain(SUBJECT);
    });

    it("prefers the outermost known code", () => {
      const error = Object.assign(new Error("outer"), {
        code: "ECONNRESET",
        cause: Object.assign(new Error("inner"), { code: "P2028" }),
      });
      expect(messageSafeErrorFields(error).code).toBe("ECONNRESET");
    });

    it("reads at most five links below the error", () => {
      const wrapped = (links: number) => {
        let error: Error = Object.assign(new Error("deep"), { code: "P2028" });
        for (let link = 0; link < links; link++) {
          error = new Error("wrapper", { cause: error });
        }
        return error;
      };
      expect(messageSafeErrorFields(wrapped(5)).code).toBe("P2028");
      expect(messageSafeErrorFields(wrapped(6)).code).toBeUndefined();
    });

    it("stops at a cycle and at a cause that throws when read", () => {
      const cyclic = new Error("a") as Error & { cause?: unknown };
      cyclic.cause = new Error("b", { cause: cyclic });
      expect(messageSafeErrorFields(cyclic)).toEqual({ errorName: "Error" });

      const throwing = new Error("c");
      Object.defineProperty(throwing, "cause", {
        get() {
          throw new Error(SUBJECT);
        },
      });
      expect(messageSafeErrorFields(throwing)).toEqual({ errorName: "Error" });
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
