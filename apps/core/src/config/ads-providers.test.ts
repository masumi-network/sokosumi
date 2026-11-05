import { describe, expect, it } from "vitest";

import { adProviderForToolkit, isProjectAdProvider } from "./ads-providers";

describe("isProjectAdProvider", () => {
  it("accepts known providers", () => {
    expect(isProjectAdProvider("google_ads")).toBe(true);
    expect(isProjectAdProvider("meta_ads")).toBe(true);
  });

  it("rejects unknown providers, including inherited object keys", () => {
    expect(isProjectAdProvider("tiktok_ads")).toBe(false);
    expect(isProjectAdProvider("toString")).toBe(false);
  });
});

describe("adProviderForToolkit", () => {
  it("matches ad toolkit slugs ignoring case and whitespace", () => {
    expect(adProviderForToolkit("googleads")?.name).toBe("Google Ads");
    expect(adProviderForToolkit("GoogleAds ")?.name).toBe("Google Ads");
    expect(adProviderForToolkit("metaads")?.name).toBe("Meta Ads");
  });

  it("rejects other toolkits", () => {
    expect(adProviderForToolkit("gmail")).toBeUndefined();
  });
});
