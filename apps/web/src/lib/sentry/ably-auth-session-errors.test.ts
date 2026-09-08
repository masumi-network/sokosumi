import { describe, expect, it } from "vitest";
import { createErrorEvent } from "./__tests__/error-event-fixture";
import {
  ablyAuthSessionIgnoreErrors,
  isAblyAuthSessionErrorMessage,
} from "./ably-auth-session-errors";
import { beforeSendClientEvent } from "./third-party-fetch-errors";

describe("isAblyAuthSessionErrorMessage", () => {
  it("matches the SOKOSUMI-RT authUrl 401 message", () => {
    expect(
      isAblyAuthSessionErrorMessage(
        'Error response received from server: 401 body was: {"error":"Unauthorized"}',
      ),
    ).toBe(true);
  });

  it("matches the authCallback session-loss error", () => {
    expect(
      isAblyAuthSessionErrorMessage("Ably auth failed: session is gone"),
    ).toBe(true);
  });

  it("does not match unrelated Ably unauthorized errors", () => {
    expect(isAblyAuthSessionErrorMessage("Unauthorized to publish")).toBe(
      false,
    );
    expect(
      isAblyAuthSessionErrorMessage(
        'Error response received from server: 403 body was: {"error":"Forbidden"}',
      ),
    ).toBe(false);
    expect(isAblyAuthSessionErrorMessage("Ably auth failed (502)")).toBe(false);
  });
});

describe("ablyAuthSessionIgnoreErrors", () => {
  it("exports patterns used by Sentry ignoreErrors", () => {
    expect(ablyAuthSessionIgnoreErrors.length).toBeGreaterThan(0);
  });
});

describe("beforeSendClientEvent Ably auth session", () => {
  it("drops the SOKOSUMI-RT Ably authUrl 401 message", () => {
    expect(
      beforeSendClientEvent(
        createErrorEvent({
          exception: {
            values: [
              {
                value:
                  'Error response received from server: 401 body was: {"error":"Unauthorized"}',
              },
            ],
          },
        }),
        {},
      ),
    ).toBeNull();
  });

  it("keeps unrelated Ably unauthorized errors", () => {
    const event = createErrorEvent({
      exception: {
        values: [
          {
            value: "Unauthorized to publish",
          },
        ],
      },
    });
    expect(beforeSendClientEvent(event, {})).toBe(event);
  });
});
