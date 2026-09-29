import type { OAuthOptions } from "@better-auth/oauth-provider";

export const oauthRefreshTokenOptions = {
  refreshTokenExpiresIn: 7_776_000, // 90 days (default: 2_592_000)
  // Refresh tokens rotate on every use, and reusing a rotated one revokes the
  // whole token family. CMO renews on several serverless instances, and the CLI
  // and Apple clients can refresh in parallel, so two requests often race on
  // the same token. For 30 seconds after rotation Core replays the same token
  // response instead of signing the person out (default: 0, off).
  refreshTokenReuseInterval: 30,
} satisfies Partial<OAuthOptions>;
