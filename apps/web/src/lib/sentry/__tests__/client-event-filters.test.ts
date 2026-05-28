import { describe, expect, it } from "vitest";

import { shouldDropThirdPartyAnalyticsNoise } from "@/lib/sentry/client-event-filters";

function createPlausibleFetchErrorEvent(
  overrides: { message?: string; filenames?: string[] } = {},
): Parameters<typeof shouldDropThirdPartyAnalyticsNoise>[0] {
  const message =
    overrides.message ?? "TypeError: Failed to fetch (plausible.io)";
  const filenames = overrides.filenames ?? [
    "app:///js/script.file-downloads.hash.outbound-links.pageview-props.tagged-events.js",
    "app:///injectScriptAdjust.js",
  ];

  return {
    exception: {
      values: [
        {
          value: message,
          stacktrace: {
            frames: filenames.map((filename) => ({ filename })),
          },
        },
      ],
    },
  };
}

describe("shouldDropThirdPartyAnalyticsNoise", () => {
  it("drops plausible.io failed fetch errors", () => {
    expect(
      shouldDropThirdPartyAnalyticsNoise(createPlausibleFetchErrorEvent()),
    ).toBe(true);
  });

  it("drops plausible script failures wrapped by browser extensions", () => {
    expect(
      shouldDropThirdPartyAnalyticsNoise(
        createPlausibleFetchErrorEvent({
          message: "TypeError: Failed to fetch",
          filenames: [
            "app:///js/script.plausible.io.js",
            "app:///frame_ant/frame_ant.js",
          ],
        }),
      ),
    ).toBe(true);
  });

  it("keeps app fetch failures", () => {
    expect(
      shouldDropThirdPartyAnalyticsNoise(
        createPlausibleFetchErrorEvent({
          message: "TypeError: Failed to fetch",
          filenames: ["webpack:///src/lib/clients/core.shared.ts"],
        }),
      ),
    ).toBe(false);
  });

  it("keeps failed fetch errors for non-analytics hosts", () => {
    expect(
      shouldDropThirdPartyAnalyticsNoise(
        createPlausibleFetchErrorEvent({
          message: "TypeError: Failed to fetch (api.sokosumi.com)",
          filenames: ["webpack:///src/lib/clients/core.shared.ts"],
        }),
      ),
    ).toBe(false);
  });
});
