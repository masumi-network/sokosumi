import type { Event } from "@sentry/core";
import { describe, expect, it } from "vitest";

import { shouldDropThirdPartyClientError } from "@/lib/sentry/should-drop-third-party-client-error";

function createEvent(
  message: string,
  frames: Event["exception"] = undefined,
): Event {
  return {
    exception: frames ?? {
      values: [
        {
          type: "TypeError",
          value: message,
          stacktrace: {
            frames: [
              {
                filename: "app:///li.lms-analytics/insight.old.min.js",
                in_app: false,
              },
            ],
          },
        },
      ],
    },
  };
}

describe("shouldDropThirdPartyClientError", () => {
  it("drops LinkedIn Insight pixel fetch failures (SOKOSUMI-P2)", () => {
    const event = createEvent(
      "TypeError: Failed to fetch (px.ads.linkedin.com)",
    );

    expect(shouldDropThirdPartyClientError(event)).toBe(true);
  });

  it("drops Plausible analytics fetch failures (SOKOSUMI-5J)", () => {
    const event = createEvent("TypeError: Failed to fetch (plausible.io)");

    expect(shouldDropThirdPartyClientError(event)).toBe(true);
  });

  it("drops Usercentrics dynamic import failures (SOKOSUMI-GK)", () => {
    const event = createEvent(
      "TypeError: Failed to fetch dynamically imported module: https://web.cmp.usercentrics.eu/ui/v/3.121.1/WebSdk.lib.44b003b5.js. Error: undefined",
    );

    expect(shouldDropThirdPartyClientError(event)).toBe(true);
  });

  it("keeps api.sokosumi.com fetch failures", () => {
    const event = createEvent("TypeError: Failed to fetch (api.sokosumi.com)", {
      values: [
        {
          type: "TypeError",
          value: "TypeError: Failed to fetch (api.sokosumi.com)",
          stacktrace: {
            frames: [
              {
                filename: "webpack://web/src/lib/clients/core.client.ts",
                in_app: true,
              },
            ],
          },
        },
      ],
    });

    expect(shouldDropThirdPartyClientError(event)).toBe(false);
  });

  it("keeps app.sokosumi.com fetch failures", () => {
    const event = createEvent("TypeError: Failed to fetch (app.sokosumi.com)");

    expect(shouldDropThirdPartyClientError(event)).toBe(false);
  });

  it("keeps generic Failed to fetch when Sokosumi code is in the stack", () => {
    const event = createEvent("TypeError: Failed to fetch", {
      values: [
        {
          type: "TypeError",
          value: "TypeError: Failed to fetch",
          stacktrace: {
            frames: [
              {
                filename: "webpack://web/src/hooks/use-job-submission.ts",
                in_app: true,
              },
            ],
          },
        },
      ],
    });

    expect(shouldDropThirdPartyClientError(event)).toBe(false);
  });
});
