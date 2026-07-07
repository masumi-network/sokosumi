import { describe, expect, it } from "vitest";

import {
  beforeSendServerEvent,
  isExpectedAuthRequestError,
  isExpectedAuthSentryEvent,
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

  it("matches masked production RSC render noise", () => {
    expect(
      isExpectedClientNoiseErrorMessage(
        "An error occurred in the Server Components render. The specific message is omitted in production builds to avoid leaking sensitive details. A digest property is included on this error instance which may provide additional details about the nature of the error.",
      ),
    ).toBe(true);
  });

  it("matches Cardano wallet extension REQUEST_ID noise", () => {
    expect(
      isExpectedClientNoiseErrorMessage(
        "Cannot read properties of undefined (reading 'REQUEST_ID')",
      ),
    ).toBe(true);
  });

  it("matches MetaMask connection noise", () => {
    expect(
      isExpectedClientNoiseErrorMessage("Failed to connect to MetaMask"),
    ).toBe(true);
  });

  it("matches history.replaceState rate limit noise", () => {
    expect(
      isExpectedClientNoiseErrorMessage(
        "Attempt to use history.replaceState() more than 100 times per 10 seconds",
      ),
    ).toBe(true);
  });
});
