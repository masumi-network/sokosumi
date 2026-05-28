import type { ErrorEvent } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";
import {
  shouldDropThirdPartyClientError,
  thirdPartyDenyUrls,
} from "@/lib/sentry/third-party-error-filter";

function errorEvent(message: string, filenames: string[] = []): ErrorEvent {
  return {
    exception: {
      values: [
        {
          type: "TypeError",
          value: message,
          stacktrace: {
            frames: filenames.map((filename) => ({
              filename,
              in_app: true,
            })),
          },
        },
      ],
    },
  };
}

describe("shouldDropThirdPartyClientError", () => {
  it("drops LinkedIn ads pixel fetch failures", () => {
    expect(
      shouldDropThirdPartyClientError(
        errorEvent("Failed to fetch (px.ads.linkedin.com)", [
          "app:///li.lms-analytics/insight.old.min.js",
        ]),
      ),
    ).toBe(true);
  });

  it("drops Plausible analytics fetch failures", () => {
    expect(
      shouldDropThirdPartyClientError(
        errorEvent("Failed to fetch (plausible.io)", [
          "app:///js/script.file-downloads.hash.outbound-links.pageview-props.tagged-events.js",
        ]),
      ),
    ).toBe(true);
  });

  it("drops Usercentrics dynamic import failures", () => {
    expect(
      shouldDropThirdPartyClientError(
        errorEvent(
          "Failed to fetch dynamically imported module: https://web.cmp.usercentrics.eu/ui/v/3.121.1/WebSdk.lib.44b003b5.js. Error: undefined",
        ),
      ),
    ).toBe(true);
  });

  it("keeps first-party app fetch failures", () => {
    expect(
      shouldDropThirdPartyClientError(
        errorEvent("Failed to fetch (app.sokosumi.com)", [
          "node_modules/.pnpm/@better-fetch+fetch@1.1.21/node_modules/@better-fetch/fetch/dist/index.js",
        ]),
      ),
    ).toBe(false);
  });

  it("keeps API fetch failures", () => {
    expect(
      shouldDropThirdPartyClientError(
        errorEvent("Failed to fetch (api.sokosumi.com)"),
      ),
    ).toBe(false);
  });
});

describe("thirdPartyDenyUrls", () => {
  it("includes LinkedIn and Plausible script origins", () => {
    const patterns = thirdPartyDenyUrls.filter(
      (entry): entry is RegExp => entry instanceof RegExp,
    );
    expect(
      patterns.some((pattern) => pattern.test("px.ads.linkedin.com")),
    ).toBe(true);
    expect(patterns.some((pattern) => pattern.test("plausible.io"))).toBe(true);
  });
});
