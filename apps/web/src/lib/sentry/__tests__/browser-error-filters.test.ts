import type { ErrorEvent } from "@sentry/core";
import { describe, expect, it } from "vitest";

import {
  buildIgnoredThirdPartyFetchErrorPatterns,
  isIgnoredThirdPartyDynamicImportFailure,
  isIgnoredThirdPartyFetchFailure,
  shouldDropThirdPartyBrowserError,
} from "@/lib/sentry/browser-error-filters";

function createErrorEvent(message: string): ErrorEvent {
  return {
    exception: {
      values: [{ type: "TypeError", value: message }],
    },
  };
}

describe("isIgnoredThirdPartyFetchFailure", () => {
  it("ignores LinkedIn Insight Tag fetch failures", () => {
    expect(
      isIgnoredThirdPartyFetchFailure(
        "TypeError: Failed to fetch (px.ads.linkedin.com)",
      ),
    ).toBe(true);
  });

  it("ignores Plausible analytics fetch failures", () => {
    expect(
      isIgnoredThirdPartyFetchFailure(
        "TypeError: Failed to fetch (plausible.io)",
      ),
    ).toBe(true);
  });

  it("keeps Sokosumi API fetch failures", () => {
    expect(
      isIgnoredThirdPartyFetchFailure(
        "TypeError: Failed to fetch (api.sokosumi.com)",
      ),
    ).toBe(false);
  });

  it("keeps Sokosumi app fetch failures", () => {
    expect(
      isIgnoredThirdPartyFetchFailure(
        "TypeError: Failed to fetch (app.sokosumi.com)",
      ),
    ).toBe(false);
  });

  it("does not ignore generic fetch failures without a host", () => {
    expect(isIgnoredThirdPartyFetchFailure("TypeError: Failed to fetch")).toBe(
      false,
    );
  });
});

describe("isIgnoredThirdPartyDynamicImportFailure", () => {
  it("ignores Usercentrics dynamic import failures", () => {
    expect(
      isIgnoredThirdPartyDynamicImportFailure(
        "TypeError: Failed to fetch dynamically imported module: https://web.cmp.usercentrics.eu/ui/v/3.121.1/WebSdk.lib.44b003b5.js. Error: undefined",
      ),
    ).toBe(true);
  });
});

describe("shouldDropThirdPartyBrowserError", () => {
  it("drops Sentry events for ignored third-party network errors", () => {
    expect(
      shouldDropThirdPartyBrowserError(
        createErrorEvent("TypeError: Failed to fetch (px.ads.linkedin.com)"),
      ),
    ).toBe(true);
  });

  it("keeps Sokosumi network errors", () => {
    expect(
      shouldDropThirdPartyBrowserError(
        createErrorEvent("TypeError: Failed to fetch (api.sokosumi.com)"),
      ),
    ).toBe(false);
  });
});

describe("buildIgnoredThirdPartyFetchErrorPatterns", () => {
  it("includes host-specific fetch failure patterns", () => {
    const patterns = buildIgnoredThirdPartyFetchErrorPatterns();

    expect(
      patterns.some((pattern) =>
        pattern.test("TypeError: Failed to fetch (px.ads.linkedin.com)"),
      ),
    ).toBe(true);
    expect(
      patterns.some((pattern) =>
        pattern.test("TypeError: Failed to fetch (api.sokosumi.com)"),
      ),
    ).toBe(false);
  });
});
