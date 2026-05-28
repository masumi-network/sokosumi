import type { ErrorEvent, EventHint } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";
import {
  sentryBeforeSend,
  shouldDropBrowserError,
} from "@/lib/sentry/browser-error-filters";

function linkedInInsightEvent(): ErrorEvent {
  return {
    exception: {
      values: [
        {
          value: "TypeError: Failed to fetch (px.ads.linkedin.com)",
          stacktrace: {
            frames: [
              { filename: "app:///li.lms-analytics/insight.old.min.js" },
              { filename: "app:///frame_ant/frame_ant.js" },
            ],
          },
        },
      ],
    },
  };
}

function plausibleEvent(): ErrorEvent {
  return {
    exception: {
      values: [
        {
          value: "TypeError: Failed to fetch (plausible.io)",
          stacktrace: {
            frames: [
              {
                filename:
                  "app:///js/script.file-downloads.hash.outbound-links.pageview-props.tagged-events.js",
              },
            ],
          },
        },
      ],
    },
  };
}

function appApiFetchEvent(): ErrorEvent {
  return {
    exception: {
      values: [
        {
          value: "TypeError: Failed to fetch (api.sokosumi.com)",
          stacktrace: {
            frames: [
              {
                filename:
                  "webpack:///./apps/web/src/lib/clients/core.shared.ts",
              },
            ],
          },
        },
      ],
    },
  };
}

function usercentricsDynamicImportEvent(): ErrorEvent {
  return {
    exception: {
      values: [
        {
          value:
            "TypeError: Failed to fetch dynamically imported module: https://web.cmp.usercentrics.eu/ui/v/3.121.1/WebSdk.lib.44b003b5.js. Error: undefined",
          stacktrace: {
            frames: [
              { filename: "app:///web.cmp.usercentrics.eu/ui/loader.js" },
            ],
          },
        },
      ],
    },
  };
}

describe("shouldDropBrowserError", () => {
  it("drops LinkedIn Insight Tag fetch failures", () => {
    expect(
      shouldDropBrowserError(linkedInInsightEvent(), {} as EventHint),
    ).toBe(true);
  });

  it("drops Plausible analytics fetch failures", () => {
    expect(shouldDropBrowserError(plausibleEvent(), {} as EventHint)).toBe(
      true,
    );
  });

  it("drops Usercentrics dynamic import failures", () => {
    expect(
      shouldDropBrowserError(usercentricsDynamicImportEvent(), {} as EventHint),
    ).toBe(true);
  });

  it("keeps first-party API fetch failures", () => {
    expect(shouldDropBrowserError(appApiFetchEvent(), {} as EventHint)).toBe(
      false,
    );
  });

  it("reads the message from the original exception hint", () => {
    const hint: EventHint = {
      originalException: new TypeError("Failed to fetch (px.ads.linkedin.com)"),
    };
    expect(shouldDropBrowserError({} as ErrorEvent, hint)).toBe(true);
  });
});

describe("sentryBeforeSend", () => {
  it("returns null when the event should be dropped", () => {
    expect(
      sentryBeforeSend(linkedInInsightEvent(), {} as EventHint),
    ).toBeNull();
  });

  it("returns the event when it should be kept", () => {
    const event = appApiFetchEvent();
    expect(sentryBeforeSend(event, {} as EventHint)).toBe(event);
  });
});
