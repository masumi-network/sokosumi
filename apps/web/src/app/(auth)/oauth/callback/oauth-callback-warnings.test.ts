import { describe, expect, it } from "vitest";

import { getOAuthCallbackTokenWarnings } from "./oauth-callback-warnings";

describe("getOAuthCallbackTokenWarnings", () => {
  it("shows identity warning without refresh for openid-only tokens", () => {
    expect(
      getOAuthCallbackTokenWarnings({
        scope: "openid",
      }),
    ).toEqual({
      showApiAccessWarning: false,
      showRefreshWarning: false,
    });
  });

  it("shows API warning when sokosumi:api is on the access token", () => {
    expect(
      getOAuthCallbackTokenWarnings({
        scope: "openid sokosumi:api",
      }),
    ).toEqual({
      showApiAccessWarning: true,
      showRefreshWarning: false,
    });
  });

  it("shows refresh warning when refresh_token is present", () => {
    expect(
      getOAuthCallbackTokenWarnings({
        scope: "openid",
        refresh_token: "soko_refresh_token_abc",
      }),
    ).toEqual({
      showApiAccessWarning: false,
      showRefreshWarning: true,
    });
  });

  it("shows refresh warning when offline_access is in scope without RT field", () => {
    expect(
      getOAuthCallbackTokenWarnings({
        scope: "openid offline_access",
      }),
    ).toEqual({
      showApiAccessWarning: false,
      showRefreshWarning: true,
    });
  });

  it("stacks API and refresh warnings when both apply", () => {
    expect(
      getOAuthCallbackTokenWarnings({
        scope: "openid sokosumi:api offline_access",
        refresh_token: "soko_refresh_token_abc",
      }),
    ).toEqual({
      showApiAccessWarning: true,
      showRefreshWarning: true,
    });
  });
});
