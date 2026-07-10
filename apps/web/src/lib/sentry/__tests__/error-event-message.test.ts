import type { ErrorEvent, EventHint } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";

import { createErrorEvent } from "@/lib/sentry/__tests__/error-event-fixture";
import { getSentryErrorEventMessage } from "@/lib/sentry/error-event-message";

describe("getSentryErrorEventMessage", () => {
  it("prefers exception value over event message", () => {
    const event = createErrorEvent({
      message: "ignored",
      exception: {
        values: [
          { value: "Rendered more hooks than during the previous render." },
        ],
      },
    });

    expect(getSentryErrorEventMessage(event)).toBe(
      "Rendered more hooks than during the previous render.",
    );
  });

  it("falls back to hint.originalException message", () => {
    const event = createErrorEvent({ message: "" });
    const hint: EventHint = {
      originalException: new Error(
        "Rendered more hooks than during the previous render.",
      ),
    };

    expect(getSentryErrorEventMessage(event, hint)).toBe(
      "Rendered more hooks than during the previous render.",
    );
  });
});
