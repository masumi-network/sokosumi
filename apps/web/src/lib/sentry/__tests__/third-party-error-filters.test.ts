import { describe, expect, it } from "vitest";

import { isIgnoredThirdPartyBrowserErrorMessage } from "@/lib/sentry/third-party-error-filters";

describe("isIgnoredThirdPartyBrowserErrorMessage", () => {
  it("ignores LinkedIn Insight Tag fetch failures", () => {
    expect(
      isIgnoredThirdPartyBrowserErrorMessage(
        "TypeError: Failed to fetch (px.ads.linkedin.com)",
      ),
    ).toBe(true);
  });

  it("ignores Plausible analytics fetch failures", () => {
    expect(
      isIgnoredThirdPartyBrowserErrorMessage(
        "TypeError: Failed to fetch (plausible.io)",
      ),
    ).toBe(true);
  });

  it("does not ignore first-party fetch errors", () => {
    expect(
      isIgnoredThirdPartyBrowserErrorMessage("Failed to fetch job: Not Found"),
    ).toBe(false);
    expect(
      isIgnoredThirdPartyBrowserErrorMessage(
        "TypeError: Failed to fetch (app.sokosumi.com)",
      ),
    ).toBe(false);
    expect(
      isIgnoredThirdPartyBrowserErrorMessage("TypeError: Failed to fetch"),
    ).toBe(false);
  });
});
