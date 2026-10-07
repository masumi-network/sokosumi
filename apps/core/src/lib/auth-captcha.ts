import {
  AUTH_CAPTCHA_ACTION,
  AUTH_CAPTCHA_HEADER,
  TURNSTILE_ALWAYS_PASS_SECRET,
} from "@sokosumi/utils";
import type { BetterAuthPlugin } from "better-auth";
import { captcha } from "better-auth/plugins";

import { consumeCaptchaPass, isCaptchaPass } from "./auth-captcha-pass.js";
import { EMAIL_CODE_SEND_PATH } from "./auth-email-code-sign-in.js";
import { SIGN_UP_EMAIL_STATUS_PATH } from "./auth-sign-up-email-status.js";

async function readSignInCodeEmail(request: Request) {
  const body: unknown = await request
    .clone()
    .json()
    .catch(() => null);
  if (
    typeof body === "object" &&
    body !== null &&
    "type" in body &&
    body.type === "sign-in" &&
    "email" in body &&
    typeof body.email === "string"
  ) {
    return body.email;
  }
  return null;
}

export function createAuthCaptchaPlugin(secretKey: string | undefined) {
  // Omitting the secret disables server-side verification in any environment.
  if (!secretKey) return { id: "captcha-disabled" };
  const turnstile = captcha({
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
      SIGN_UP_EMAIL_STATUS_PATH,
      "/sign-in/email",
      "/request-password-reset",
      "/send-verification-email",
      "/change-email",
      EMAIL_CODE_SEND_PATH,
    ],
  });
  return {
    ...turnstile,
    // The email step's answer carries a single-use pass for the sign-in code
    // sent right after it, so that send needs no second captcha.
    onRequest: async (request, ctx) => {
      const pass = request.headers.get(AUTH_CAPTCHA_HEADER);
      const basePath = ctx.options.basePath ?? "/api/auth";
      if (
        !pass ||
        !isCaptchaPass(pass) ||
        new URL(request.url).pathname !== `${basePath}${EMAIL_CODE_SEND_PATH}`
      ) {
        return turnstile.onRequest(request, ctx);
      }
      const email = await readSignInCodeEmail(request);
      if (email && (await consumeCaptchaPass(ctx, pass, email))) return;
      return {
        response: Response.json(
          {
            message: "Captcha verification failed",
            code: "VERIFICATION_FAILED",
          },
          { status: 403 },
        ),
      };
    },
  } satisfies BetterAuthPlugin;
}
