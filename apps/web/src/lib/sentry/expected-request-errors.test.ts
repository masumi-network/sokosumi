import { describe, expect, it } from "vitest";

import {
  beforeSendServerEvent,
  isExpectedAuthRequestError,
  isExpectedAuthSentryEvent,
  isExpectedBusinessRequestError,
  isExpectedBusinessSentryEvent,
  isExpectedClientNoiseErrorMessage,
} from "@/lib/sentry/expected-request-errors";

describe("isExpectedAuthRequestError", () => {
  it("matches UnAuthenticatedError by name", () => {
    const error = new Error("User is not authenticated");
    error.name = "UnAuthenticatedError";

    expect(isExpectedAuthRequestError(error)).toBe(true);
  });

  it("matches expired Core session messages", () => {
    expect(
      isExpectedAuthRequestError(
        new Error("Invalid, expired or missing session"),
      ),
    ).toBe(true);
  });

  it("ignores unrelated errors", () => {
    expect(isExpectedAuthRequestError(new Error("Database unavailable"))).toBe(
      false,
    );
  });
});

describe("isExpectedBusinessRequestError", () => {
  it("matches Core API 4xx errors", () => {
    const error = new Error("Cannot move a task with related tasks.");
    error.name = "CoreApiRequestError";
    (error as Error & { status: number }).status = 409;

    expect(isExpectedBusinessRequestError(error)).toBe(true);
  });

  it("matches rethrown business validation messages", () => {
    expect(
      isExpectedBusinessRequestError(
        new Error(
          "Cannot move a task with related tasks. Remove its links first.",
        ),
      ),
    ).toBe(true);
  });

  it("ignores 5xx Core API errors", () => {
    const error = new Error("Database unavailable");
    error.name = "CoreApiRequestError";
    (error as Error & { status: number }).status = 503;

    expect(isExpectedBusinessRequestError(error)).toBe(false);
  });

  it("ignores unrelated errors", () => {
    expect(
      isExpectedBusinessRequestError(new Error("Database unavailable")),
    ).toBe(false);
  });
});

describe("isExpectedBusinessSentryEvent", () => {
  it("drops task workspace conflict events", () => {
    expect(
      isExpectedBusinessSentryEvent({
        type: undefined,
        exception: {
          values: [
            {
              type: "Error",
              value:
                "Cannot move a task with related tasks. Remove its links first.",
            },
          ],
        },
      }),
    ).toBe(true);
  });
});

describe("isExpectedAuthSentryEvent", () => {
  it("drops UnAuthenticatedError events", () => {
    expect(
      isExpectedAuthSentryEvent({
        type: undefined,
        exception: {
          values: [
            {
              type: "UnAuthenticatedError",
              value: "User is not authenticated",
            },
          ],
        },
      }),
    ).toBe(true);
  });

  it("drops CoreApiRequestError session expiry events", () => {
    expect(
      isExpectedAuthSentryEvent({
        type: undefined,
        exception: {
          values: [
            {
              type: "CoreApiRequestError",
              value: "Invalid, expired or missing session",
            },
          ],
        },
      }),
    ).toBe(true);
  });
});

describe("beforeSendServerEvent", () => {
  it("returns null for expected auth events", () => {
    expect(
      beforeSendServerEvent(
        {
          type: undefined,
          exception: {
            values: [
              {
                type: "UnAuthenticatedError",
                value: "User is not authenticated",
              },
            ],
          },
        },
        {},
      ),
    ).toBeNull();
  });

  it("passes through unexpected events", () => {
    const event = {
      type: undefined,
      exception: {
        values: [{ type: "Error", value: "Database unavailable" }],
      },
    };

    expect(beforeSendServerEvent(event, {})).toBe(event);
  });

  it("returns null for expected business validation events", () => {
    expect(
      beforeSendServerEvent(
        {
          type: undefined,
          exception: {
            values: [
              {
                type: "Error",
                value:
                  "Cannot move a task with related tasks. Remove its links first.",
              },
            ],
          },
        },
        {},
      ),
    ).toBeNull();
  });

  it("returns null for legacy web auth Prisma noise", () => {
    expect(
      beforeSendServerEvent(
        {
          type: undefined,
          transaction: "GET /api/auth/[...all]",
          exception: {
            values: [
              {
                type: "PrismaClientKnownRequestError",
                value:
                  "Invalid `prisma.rateLimit.findMany()` invocation: Authentication failed",
              },
            ],
          },
        },
        {},
      ),
    ).toBeNull();
  });
});

describe("isExpectedClientNoiseErrorMessage", () => {
  it("matches Next.js router hook mismatch noise", () => {
    expect(
      isExpectedClientNoiseErrorMessage(
        "Rendered more hooks than during the previous render.",
      ),
    ).toBe(true);
  });

  it("matches browser extension bridge rejections", () => {
    expect(
      isExpectedClientNoiseErrorMessage(
        "Object Not Found Matching Id:2, MethodName:update, ParamCount:4",
      ),
    ).toBe(true);
  });

  it("matches masked production RSC render errors", () => {
    expect(
      isExpectedClientNoiseErrorMessage(
        "An error occurred in the Server Components render. The specific message is omitted in production builds to avoid leaking sensitive details.",
      ),
    ).toBe(true);
  });

  it("matches Next 16 client UnrecognizedActionError (stale deploy skew)", () => {
    expect(
      isExpectedClientNoiseErrorMessage(
        'Server Action "009d9de8d488da49c4dc1688d001bc703beae84c91" was not found on the server. \nRead more: https://nextjs.org/docs/messages/failed-to-find-server-action',
      ),
    ).toBe(true);
  });
});
