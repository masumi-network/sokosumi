import { describe, expect, it } from "vitest";

import {
  buildOAuthClientGrantTypes,
  buildOAuthClientScopeParam,
  hasCoreApiOAuthScope,
  hasOAuthScope,
  hasOfflineAccessOAuthScope,
  OAUTH_PROVIDER_SCOPES,
  OAUTH_SCOPE_CORE_API,
  OAUTH_SCOPE_MCP,
  OAUTH_SCOPE_OFFLINE_ACCESS,
  OAUTH_SCOPE_OPENID,
} from "./oauth-scopes";

describe("oauth scopes", () => {
  it("exports provider scopes including offline_access", () => {
    expect(OAUTH_SCOPE_OPENID).toBe("openid");
    expect(OAUTH_SCOPE_CORE_API).toBe("sokosumi:api");
    expect(OAUTH_SCOPE_OFFLINE_ACCESS).toBe("offline_access");
    expect(OAUTH_PROVIDER_SCOPES).toEqual([
      "openid",
      "sokosumi:api",
      "offline_access",
    ]);
  });

  it("builds scope params from API and offline flags", () => {
    expect(
      buildOAuthClientScopeParam({
        includeCoreApi: false,
        includeOfflineAccess: false,
      }),
    ).toBe("openid");
    expect(
      buildOAuthClientScopeParam({
        includeCoreApi: true,
        includeOfflineAccess: false,
      }),
    ).toBe("openid sokosumi:api");
    expect(
      buildOAuthClientScopeParam({
        includeCoreApi: false,
        includeOfflineAccess: true,
      }),
    ).toBe("openid offline_access");
    expect(
      buildOAuthClientScopeParam({
        includeCoreApi: true,
        includeOfflineAccess: true,
      }),
    ).toBe("openid sokosumi:api offline_access");
  });

  it("builds grant_types from offline flag", () => {
    expect(buildOAuthClientGrantTypes(false)).toEqual(["authorization_code"]);
    expect(buildOAuthClientGrantTypes(true)).toEqual([
      "authorization_code",
      "refresh_token",
    ]);
  });

  it("detects Core API and offline scopes", () => {
    expect(hasCoreApiOAuthScope(["openid", "offline_access"])).toBe(false);
    expect(hasOfflineAccessOAuthScope(["openid"])).toBe(false);
    expect(hasOfflineAccessOAuthScope(["openid", "offline_access"])).toBe(true);
    expect(hasOfflineAccessOAuthScope("openid offline_access")).toBe(true);
    expect(hasOfflineAccessOAuthScope(undefined)).toBe(false);
  });

  it("keeps the MCP scope out of the scopes CMO requests", () => {
    expect(OAUTH_SCOPE_MCP).toBe("sokosumi:mcp");
    expect(OAUTH_PROVIDER_SCOPES).not.toContain(OAUTH_SCOPE_MCP);
  });

  it("detects any scope in a list or a space-separated string", () => {
    expect(hasOAuthScope("openid sokosumi:mcp", OAUTH_SCOPE_MCP)).toBe(true);
    expect(hasOAuthScope(["sokosumi:api"], OAUTH_SCOPE_MCP)).toBe(false);
    expect(hasOAuthScope(null, OAUTH_SCOPE_MCP)).toBe(false);
  });
});
