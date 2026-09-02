import { describe, expect, it } from "vitest";
import { createErrorEvent } from "./__tests__/error-event-fixture";
import {
  ablyChannelLifecycleIgnoreErrors,
  isAblyChannelLifecycleErrorMessage,
} from "./ably-channel-lifecycle-errors";
import { beforeSendClientEvent } from "./third-party-fetch-errors";

describe("isAblyChannelLifecycleErrorMessage", () => {
  it.each([
    "Attach request superseded by a subsequent detach request",
    "Detach request superseded by a subsequent attach request",
    "Channel detached",
    "Channel detach timed out",
    "Channel operation failed as channel state is failed",
    "Connection to server unavailable",
    "Unable to connect (network unreachable)",
  ])("matches %s", (message) => {
    expect(isAblyChannelLifecycleErrorMessage(message)).toBe(true);
  });

  it("does not match unrelated chat/realtime errors", () => {
    expect(
      isAblyChannelLifecycleErrorMessage(
        "Failed to parse ChatRoomMessageEventData from message",
      ),
    ).toBe(false);
    expect(isAblyChannelLifecycleErrorMessage("Unauthorized to publish")).toBe(
      false,
    );
  });
});

describe("ablyChannelLifecycleIgnoreErrors", () => {
  it("exports patterns used by Sentry ignoreErrors", () => {
    expect(ablyChannelLifecycleIgnoreErrors.length).toBeGreaterThan(0);
  });
});

describe("beforeSendClientEvent Ably lifecycle", () => {
  it("drops attach/detach race events", () => {
    expect(
      beforeSendClientEvent(
        createErrorEvent({
          exception: {
            values: [
              {
                value:
                  "Attach request superseded by a subsequent detach request",
              },
            ],
          },
        }),
        {},
      ),
    ).toBeNull();
  });

  it("drops Ably give-up when the client network is unreachable", () => {
    expect(
      beforeSendClientEvent(
        createErrorEvent({
          exception: {
            values: [
              {
                value: "Unable to connect (network unreachable)",
              },
            ],
          },
        }),
        {},
      ),
    ).toBeNull();
  });

  it("drops channel state failed events from useChannel", () => {
    expect(
      beforeSendClientEvent(
        createErrorEvent({
          exception: {
            values: [
              {
                value: "Channel operation failed as channel state is failed",
              },
            ],
          },
        }),
        {},
      ),
    ).toBeNull();
  });

  it("keeps unrelated Ably-adjacent application errors", () => {
    const event = createErrorEvent({
      exception: {
        values: [
          {
            value: "Failed to parse ChatRoomMessageEventData from message",
          },
        ],
      },
    });
    expect(beforeSendClientEvent(event, {})).toBe(event);
  });
});
