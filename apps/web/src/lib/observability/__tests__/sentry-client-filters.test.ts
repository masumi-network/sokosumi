import { describe, expect, it } from "vitest";

import {
  getFailedFetchHost,
  isThirdPartyFetchNoise,
  shouldDropClientSentryEvent,
} from "@/lib/observability/sentry-client-filters";

describe("getFailedFetchHost", () => {
  it("parses hosts from parenthesized fetch errors", () => {
    expect(getFailedFetchHost("Failed to fetch (plausible.io)")).toBe(
      "plausible.io",
    );
    expect(getFailedFetchHost("Failed to fetch (px.ads.linkedin.com)")).toBe(
      "px.ads.linkedin.com",
    );
  });

  it("parses hosts from dynamic import fetch errors", () => {
    expect(
      getFailedFetchHost(
        "Failed to fetch dynamically imported module: https://web.cmp.usercentrics.eu/ui/v/3.121.1/WebSdk.lib.js. Error: undefined",
      ),
    ).toBe("web.cmp.usercentrics.eu");
  });
});

describe("isThirdPartyFetchNoise", () => {
  it("flags blocked analytics hosts", () => {
    expect(isThirdPartyFetchNoise("Failed to fetch (plausible.io)")).toBe(true);
    expect(
      isThirdPartyFetchNoise("Failed to fetch (pagead2.googlesyndication.com)"),
    ).toBe(true);
    expect(
      isThirdPartyFetchNoise("Failed to fetch (px.ads.linkedin.com)"),
    ).toBe(true);
  });

  it("does not flag first-party API hosts", () => {
    expect(isThirdPartyFetchNoise("Failed to fetch (api.sokosumi.com)")).toBe(
      false,
    );
    expect(isThirdPartyFetchNoise("Failed to fetch (app.sokosumi.com)")).toBe(
      false,
    );
  });
});

describe("shouldDropClientSentryEvent", () => {
  it("drops plausible fetch rejections from third-party stacks", () => {
    const event = {
      exception: {
        values: [
          {
            value: "Failed to fetch (plausible.io)",
            stacktrace: {
              frames: [
                {
                  filename:
                    "app:///js/script.file-downloads.hash.outbound-links.pageview-props.tagged-events.js",
                  in_app: false,
                },
                {
                  filename: "app:///injectScriptAdjust.js",
                  in_app: false,
                },
              ],
            },
          },
        ],
      },
    };

    expect(
      shouldDropClientSentryEvent(event, {
        originalException: new TypeError("Failed to fetch (plausible.io)"),
      }),
    ).toBe(true);
  });

  it("drops LinkedIn Insight Tag fetch failures", () => {
    const event = {
      exception: {
        values: [
          {
            type: "TypeError",
            value: "Failed to fetch (px.ads.linkedin.com)",
            stacktrace: {
              frames: [
                {
                  filename: "app:///li.lms-analytics/insight.old.min.js",
                  function: "Gt",
                  in_app: false,
                },
                {
                  filename: "app:///frame_ant/frame_ant.js",
                  function: "o",
                  in_app: false,
                },
              ],
            },
          },
        ],
      },
    };

    expect(
      shouldDropClientSentryEvent(event, {
        originalException: new TypeError(
          "Failed to fetch (px.ads.linkedin.com)",
        ),
      }),
    ).toBe(true);
  });

  it("keeps generic fetch errors with in-app frames", () => {
    const event = {
      exception: {
        values: [
          {
            value: "Failed to fetch",
            stacktrace: {
              frames: [
                {
                  filename: "app:///_next/static/chunks/app/page.js",
                  in_app: true,
                },
              ],
            },
          },
        ],
      },
    };

    expect(
      shouldDropClientSentryEvent(event, {
        originalException: new TypeError("Failed to fetch"),
      }),
    ).toBe(false);
  });

  it("keeps first-party fetch failures to Sokosumi APIs", () => {
    const event = {
      exception: {
        values: [
          {
            type: "TypeError",
            value: "Failed to fetch (api.sokosumi.com)",
            stacktrace: {
              frames: [
                {
                  filename:
                    "webpack-internal:///./src/lib/clients/core.shared.ts",
                  function: "fetchTasks",
                  in_app: true,
                },
              ],
            },
          },
        ],
      },
    };

    expect(
      shouldDropClientSentryEvent(event, {
        originalException: new TypeError("Failed to fetch (api.sokosumi.com)"),
      }),
    ).toBe(false);
  });
});
