import type { ErrorEvent, EventHint } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";

import { shouldDropBrowserEvent } from "@/lib/sentry/should-drop-browser-event";

function createEvent(message: string): ErrorEvent {
  return {
    exception: {
      values: [{ value: message, type: "TypeError" }],
    },
  };
}

const hint = {} as EventHint;

describe("shouldDropBrowserEvent", () => {
  it("drops LinkedIn Insight Tag fetch failures", () => {
    expect(
      shouldDropBrowserEvent(
        createEvent("TypeError: Failed to fetch (px.ads.linkedin.com)"),
        hint,
      ),
    ).toBe(true);
  });

  it("drops Plausible analytics fetch failures", () => {
    expect(
      shouldDropBrowserEvent(
        createEvent("TypeError: Failed to fetch (plausible.io)"),
        hint,
      ),
    ).toBe(true);
  });

  it("drops Usercentrics dynamic import failures", () => {
    expect(
      shouldDropBrowserEvent(
        createEvent(
          "TypeError: Failed to fetch dynamically imported module: https://web.cmp.usercentrics.eu/ui/v/3.121.1/WebSdk.lib.44b003b5.js. Error: undefined",
        ),
        hint,
      ),
    ).toBe(true);
  });

  it("keeps first-party API fetch failures", () => {
    expect(
      shouldDropBrowserEvent(
        createEvent("TypeError: Failed to fetch (api.sokosumi.com)"),
        hint,
      ),
    ).toBe(false);
  });

  it("keeps first-party app fetch failures", () => {
    expect(
      shouldDropBrowserEvent(
        createEvent("TypeError: Failed to fetch (app.sokosumi.com)"),
        hint,
      ),
    ).toBe(false);
  });

  it("keeps generic fetch failures without a third-party host", () => {
    expect(
      shouldDropBrowserEvent(createEvent("TypeError: Failed to fetch"), hint),
    ).toBe(false);
  });

  it("keeps unrelated application errors", () => {
    expect(
      shouldDropBrowserEvent(
        createEvent("Error: Unable to load task details"),
        hint,
      ),
    ).toBe(false);
  });
});
