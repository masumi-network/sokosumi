export const AUTH_CAPTCHA_HEADER = "x-captcha-response";
export const AUTH_CAPTCHA_ACTION = "auth";

/**
 * Cloudflare's published always-passes Turnstile secret.
 *
 * Local checkouts carry it (`scripts/local-env/bootstrap.mjs`) so the sign-in
 * widget solves itself. Its siteverify response omits `action`, so Core skips
 * `expectedAction` for it, and Core's env validation warns when a deployment
 * is holding it — siteverify succeeds for any token, forged ones included.
 */
export const TURNSTILE_ALWAYS_PASS_SECRET =
  "1x0000000000000000000000000000000AA";
