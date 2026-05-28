import { describe, expect, it } from "vitest";

import {
  beforeSendClientEvent,
  isThirdPartyAnalyticsFetchFailure,
} from "@/lib/sentry/third-party-fetch-errors";

describe("isThirdPartyAnalyticsFetchFailure", () => {
  it("returns true for Plausible fetch failures", () => {
    expect(
      isThirdPartyAnalyticsFetchFailure(
        "TypeError: Failed to fetch (plausible.io)",
      ),
    ).toBe(true);
  });

  it("returns true for LinkedIn pixel fetch failures", () => {
    expect(
      isThirdPartyAnalyticsFetchFailure(
        "TypeError: Failed to fetch (px.ads.linkedin.com)",
      ),
    ).toBe(true);
  });

  it("returns false for generic fetch failures without a host", () => {
    expect(
      isThirdPartyAnalyticsFetchFailure("TypeError: Failed to fetch"),
    ).toBe(false);
  });

  it("returns false for first-party API fetch failures", () => {
    expect(
      isThirdPartyAnalyticsFetchFailure(
        "TypeError: Failed to fetch (app.sokosumi.com)",
      ),
    ).toBe(false);
  });
});

describe("beforeSendClientEvent", () => {
  it("drops third-party analytics fetch error events", () => {
    const result = beforeSendClientEvent(
      {
        type: "error",
        exception: {
          values: [
            {
              value: "TypeError: Failed to fetch (plausible.io)",
            },
          ],
        },
      },
      {},
    );

    expect(result).toBeNull();
  });

  it("keeps application fetch error events", () => {
    const event = {
      type: "error",
      exception: {
        values: [
          {
            value: "TypeError: Failed to fetch (app.sokosumi.com)",
          },
        ],
      },
    };

    expect(beforeSendClientEvent(event, {})).toBe(event);
  });
});
