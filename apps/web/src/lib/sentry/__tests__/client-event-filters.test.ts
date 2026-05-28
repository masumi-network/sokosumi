import { describe, expect, it } from "vitest";

import {
  isThirdPartyDynamicImportFailure,
  isThirdPartyFetchFailure,
  shouldDropClientSentryEvent,
} from "@/lib/sentry/client-event-filters";

describe("client-event-filters", () => {
  it("drops third-party fetch failures such as plausible analytics", () => {
    expect(isThirdPartyFetchFailure("Failed to fetch (plausible.io)")).toBe(
      true,
    );
    expect(
      isThirdPartyFetchFailure(
        "TypeError: Failed to fetch (px.ads.linkedin.com)",
      ),
    ).toBe(true);
  });

  it("keeps first-party fetch failures", () => {
    expect(isThirdPartyFetchFailure("Failed to fetch (app.sokosumi.com)")).toBe(
      false,
    );
    expect(isThirdPartyFetchFailure("Failed to fetch (api.sokosumi.com)")).toBe(
      false,
    );
  });

  it("drops third-party dynamic import failures", () => {
    expect(
      isThirdPartyDynamicImportFailure(
        "Failed to fetch dynamically imported module: https://web.cmp.usercentrics.eu/ui/TvGdprCmpView.a460128e.js. Error: undefined",
      ),
    ).toBe(true);
  });

  it("uses beforeSend to drop third-party fetch noise", () => {
    const event = {
      exception: {
        values: [{ value: "TypeError: Failed to fetch (plausible.io)" }],
      },
    };

    expect(
      shouldDropClientSentryEvent(event, {
        originalException: new TypeError("Failed to fetch (plausible.io)"),
      }),
    ).toBe(true);
  });

  it("does not drop first-party fetch failures", () => {
    const event = {
      exception: {
        values: [{ value: "TypeError: Failed to fetch (app.sokosumi.com)" }],
      },
    };

    expect(
      shouldDropClientSentryEvent(event, {
        originalException: new TypeError("Failed to fetch (app.sokosumi.com)"),
      }),
    ).toBe(false);
  });
});
