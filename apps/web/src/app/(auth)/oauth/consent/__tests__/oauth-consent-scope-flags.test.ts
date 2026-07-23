import { describe, expect, it } from "vitest";

import { getOAuthConsentScopeFlags } from "../oauth-consent-scope-flags";

describe("getOAuthConsentScopeFlags", () => {
  it("shows neither notice for openid only", () => {
    expect(getOAuthConsentScopeFlags("openid")).toEqual({
      requestsCoreApi: false,
      requestsOfflineAccess: false,
    });
  });

  it("shows API notice when sokosumi:api is requested", () => {
    expect(getOAuthConsentScopeFlags("openid sokosumi:api")).toEqual({
      requestsCoreApi: true,
      requestsOfflineAccess: false,
    });
  });

  it("shows offline notice when offline_access is requested", () => {
    expect(getOAuthConsentScopeFlags("openid offline_access")).toEqual({
      requestsCoreApi: false,
      requestsOfflineAccess: true,
    });
  });

  it("stacks both notices when API and offline are requested", () => {
    expect(
      getOAuthConsentScopeFlags("openid sokosumi:api offline_access"),
    ).toEqual({
      requestsCoreApi: true,
      requestsOfflineAccess: true,
    });
  });

  it("handles missing scope", () => {
    expect(getOAuthConsentScopeFlags(null)).toEqual({
      requestsCoreApi: false,
      requestsOfflineAccess: false,
    });
  });
});
