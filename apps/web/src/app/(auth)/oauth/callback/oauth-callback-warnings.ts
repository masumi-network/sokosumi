import {
  hasCoreApiOAuthScope,
  hasOfflineAccessOAuthScope,
} from "@sokosumi/utils";

export interface OAuthCallbackTokenWarningInput {
  refresh_token?: string | null;
  scope?: string | null;
}

export interface OAuthCallbackTokenWarnings {
  /** Access-token warning: API vs identity-only. */
  showApiAccessWarning: boolean;
  /** Refresh-token storage warning when RT present or offline scope granted. */
  showRefreshWarning: boolean;
}

/** Derive success-screen warning branches from the token response. */
export function getOAuthCallbackTokenWarnings(
  tokenResponse: OAuthCallbackTokenWarningInput,
): OAuthCallbackTokenWarnings {
  return {
    showApiAccessWarning: hasCoreApiOAuthScope(tokenResponse.scope),
    showRefreshWarning:
      Boolean(tokenResponse.refresh_token) ||
      hasOfflineAccessOAuthScope(tokenResponse.scope),
  };
}
