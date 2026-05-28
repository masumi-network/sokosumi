import { describe, expect, it } from "vitest";

import {
  isThirdPartyFetchNoiseMessage,
  shouldDropThirdPartyFetchNoiseEvent,
} from "@/lib/sentry/third-party-fetch-noise";

describe("isThirdPartyFetchNoiseMessage", () => {
  it("matches plausible.io fetch failures", () => {
    expect(
      isThirdPartyFetchNoiseMessage(
        "TypeError: Failed to fetch (plausible.io)",
      ),
    ).toBe(true);
  });

  it("matches other known third-party analytics hosts", () => {
    expect(
      isThirdPartyFetchNoiseMessage(
        "TypeError: Failed to fetch (pagead2.googlesyndication.com)",
      ),
    ).toBe(true);
    expect(
      isThirdPartyFetchNoiseMessage(
        "TypeError: Failed to fetch (region1.google-analytics.com)",
      ),
    ).toBe(true);
  });

  it("matches usercentrics dynamic import failures", () => {
    expect(
      isThirdPartyFetchNoiseMessage(
        "TypeError: Failed to fetch dynamically imported module: https://web.cmp.usercentrics.eu/ui/v/3.121.1/WebSdk.lib.44b003b5.js. Error: undefined",
      ),
    ).toBe(true);
  });

  it("does not match first-party fetch failures", () => {
    expect(
      isThirdPartyFetchNoiseMessage(
        "TypeError: Failed to fetch (api.sokosumi.com)",
      ),
    ).toBe(false);
    expect(
      isThirdPartyFetchNoiseMessage(
        "TypeError: Failed to fetch (app.sokosumi.com)",
      ),
    ).toBe(false);
    expect(isThirdPartyFetchNoiseMessage("TypeError: Failed to fetch")).toBe(
      false,
    );
  });
});

describe("shouldDropThirdPartyFetchNoiseEvent", () => {
  it("drops events with plausible stack frames when message is empty", () => {
    expect(
      shouldDropThirdPartyFetchNoiseEvent({
        exception: {
          values: [
            {
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
      }),
    ).toBe(true);
  });

  it("keeps first-party fetch failures", () => {
    expect(
      shouldDropThirdPartyFetchNoiseEvent({
        exception: {
          values: [
            {
              value: "TypeError: Failed to fetch (api.sokosumi.com)",
              stacktrace: {
                frames: [{ filename: "app:///src/lib/clients/core.shared.ts" }],
              },
            },
          ],
        },
      }),
    ).toBe(false);
  });
});
