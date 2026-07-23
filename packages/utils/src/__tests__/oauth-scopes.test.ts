import { describe, expect, it } from "vitest";

import {
  hasCoreApiOAuthScope,
  OAUTH_CORE_API_SCOPE_PARAM,
  OAUTH_PROVIDER_SCOPES,
  OAUTH_SCOPE_CORE_API,
  OAUTH_SCOPE_OPENID,
} from "../oauth-scopes";

describe("oauth scopes", () => {
  it("exports the Core API scope string used by provider and clients", () => {
    expect(OAUTH_SCOPE_OPENID).toBe("openid");
    expect(OAUTH_SCOPE_CORE_API).toBe("sokosumi:api");
    expect(OAUTH_CORE_API_SCOPE_PARAM).toBe("openid sokosumi:api");
    expect(OAUTH_PROVIDER_SCOPES).toEqual(["openid", "sokosumi:api"]);
  });

  it("detects Core API scope presence", () => {
    expect(hasCoreApiOAuthScope(["openid"])).toBe(false);
    expect(hasCoreApiOAuthScope(["openid", "sokosumi:api"])).toBe(true);
    expect(hasCoreApiOAuthScope(undefined)).toBe(false);
  });
});
