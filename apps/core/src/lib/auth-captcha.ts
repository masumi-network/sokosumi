import {
  AUTH_CAPTCHA_ACTION,
  TURNSTILE_ALWAYS_PASS_SECRET,
} from "@sokosumi/utils";
import { captcha } from "better-auth/plugins";

import { SIGN_UP_EMAIL_STATUS_PATH } from "./auth-sign-up-email-status.js";

export function createAuthCaptchaPlugin(secretKey: string | undefined) {
  // Omitting the secret disables server-side verification in any environment.
  if (!secretKey) return { id: "captcha-disabled" };
  return captcha({
    provider: "cloudflare-turnstile",
    secretKey,
    // Dummy siteverify succeeds with no `action`; expectedAction would 403 every local token.
    expectedAction:
      secretKey === TURNSTILE_ALWAYS_PASS_SECRET
        ? undefined
        : AUTH_CAPTCHA_ACTION,
    // Custom endpoints replace Better Auth's defaults. Include every public
    // account-email entry point, including resends and address changes.
    endpoints: [
      "/sign-up/email",
      SIGN_UP_EMAIL_STATUS_PATH,
      "/sign-in/email",
      "/request-password-reset",
      "/send-verification-email",
      "/change-email",
      "/email-otp/send-verification-otp",
    ],
  });
}
