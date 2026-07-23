import {
  hasCoreApiOAuthScope,
  hasOfflineAccessOAuthScope,
} from "@sokosumi/utils";

export interface OAuthConsentScopeFlags {
  requestsCoreApi: boolean;
  requestsOfflineAccess: boolean;
}

/** Derive which consent notices to show from the authorize `scope` param. */
export function getOAuthConsentScopeFlags(
  scope: string | null | undefined,
): OAuthConsentScopeFlags {
  return {
    requestsCoreApi: hasCoreApiOAuthScope(scope),
    requestsOfflineAccess: hasOfflineAccessOAuthScope(scope),
  };
}
