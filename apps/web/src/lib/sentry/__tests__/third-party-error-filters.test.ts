import { describe, expect, it } from "vitest";

import {
  beforeSendThirdPartyClientErrorFilter,
  shouldIgnoreThirdPartyClientError,
} from "@/lib/sentry/third-party-error-filters";

describe("shouldIgnoreThirdPartyClientError", () => {
  it("ignores plausible analytics fetch failures", () => {
    expect(
      shouldIgnoreThirdPartyClientError("Failed to fetch (plausible.io)"),
    ).toBe(true);
  });

  it("ignores other known third-party analytics fetch failures", () => {
    expect(
      shouldIgnoreThirdPartyClientError(
        "Failed to fetch (px.ads.linkedin.com)",
      ),
    ).toBe(true);
    expect(
      shouldIgnoreThirdPartyClientError(
        "Failed to fetch (pagead2.googlesyndication.com)",
      ),
    ).toBe(true);
  });

  it("ignores usercentrics dynamic import failures", () => {
    expect(
      shouldIgnoreThirdPartyClientError(
        "Failed to fetch dynamically imported module: https://web.cmp.usercentrics.eu/ui/TvGdprCmpView.a460128e.js. Error: undefined",
      ),
    ).toBe(true);
  });

  it("does not ignore first-party fetch failures", () => {
    expect(
      shouldIgnoreThirdPartyClientError("Failed to fetch (app.sokosumi.com)"),
    ).toBe(false);
    expect(shouldIgnoreThirdPartyClientError("Failed to fetch")).toBe(false);
  });
});

describe("beforeSendThirdPartyClientErrorFilter", () => {
  it("drops third-party fetch failures from original exceptions", () => {
    const result = beforeSendThirdPartyClientErrorFilter(
      { message: "TypeError: Failed to fetch (plausible.io)" },
      {
        originalException: new TypeError("Failed to fetch (plausible.io)"),
      },
    );

    expect(result).toBeNull();
  });

  it("keeps first-party fetch failures", () => {
    const event = { message: "TypeError: Failed to fetch (app.sokosumi.com)" };

    const result = beforeSendThirdPartyClientErrorFilter(event, {
      originalException: new TypeError("Failed to fetch (app.sokosumi.com)"),
    });

    expect(result).toBe(event);
  });
});
