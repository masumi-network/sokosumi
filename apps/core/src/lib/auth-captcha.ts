import { captcha } from "better-auth/plugins";

export function createAuthCaptchaPlugin(secretKey: string | undefined) {
  // Deployed env validation requires a key; only local development can omit it.
  if (!secretKey) return { id: "captcha" };
  return captcha({
    provider: "cloudflare-turnstile",
    secretKey,
    expectedAction: "auth",
    // Custom endpoints replace Better Auth's defaults. Include every public
    // account-email entry point, including resends and address changes.
    endpoints: [
      "/sign-up/email",
      "/sign-in/email",
      "/request-password-reset",
      "/send-verification-email",
      "/change-email",
      "/sign-in/magic-link",
    ],
  });
}
