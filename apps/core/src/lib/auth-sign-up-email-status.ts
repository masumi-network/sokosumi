import type { BetterAuthPlugin, GenericEndpointContext } from "better-auth";
import { createAuthEndpoint } from "better-auth/api";
import { generateRandomString } from "better-auth/crypto";
import * as z from "zod";

export const SIGN_UP_EMAIL_STATUS_PATH = "/sign-up/email-status";

// Turnstile tokens never start with it, so Core tells a pass from a token.
const CAPTCHA_PASS_PREFIX = "pass_";
// Long enough for a person to read the "no account" notice and follow it.
const CAPTCHA_PASS_TTL_MS = 10 * 60 * 1_000;

type VerificationStore = Pick<
  GenericEndpointContext["context"],
  "internalAdapter"
>;

/** Every pass's verification row starts with it; the purge sync relies on it. */
export const CAPTCHA_PASS_IDENTIFIER_PREFIX = "captcha-pass:";

function captchaPassIdentifier(id: string) {
  return `${CAPTCHA_PASS_IDENTIFIER_PREFIX}${id}`;
}

export function isCaptchaPass(value: string) {
  return value.startsWith(CAPTCHA_PASS_PREFIX);
}

/**
 * Whether `pass` was issued for `email`, using it up either way. A pass lets
 * the sign-in code that follows this step skip a second captcha, so a visitor
 * Cloudflare wants to see is asked once, not twice.
 */
export async function consumeCaptchaPass(
  context: VerificationStore,
  pass: string,
  email: string,
) {
  const row = await context.internalAdapter.consumeVerificationValue(
    captchaPassIdentifier(pass.slice(CAPTCHA_PASS_PREFIX.length)),
  );
  return row?.value === email.toLowerCase();
}

async function issueCaptchaPass(context: VerificationStore, email: string) {
  const id = generateRandomString(32);
  await context.internalAdapter.createVerificationValue({
    identifier: captchaPassIdentifier(id),
    value: email,
    expiresAt: new Date(Date.now() + CAPTCHA_PASS_TTL_MS),
  });
  return `${CAPTCHA_PASS_PREFIX}${id}`;
}

/**
 * Tells the first sign-up step whether an email already has an account, so a
 * person who has one is sent to sign-in before typing a name and a password.
 *
 * It also says whether that account has a password, so sign-in opens on the
 * password instead of emailing a code. A code sign-in to an account whose
 * address is unproven removes its password (`revokeUnprovenAccountAccess`).
 * That is one fact more than "exists", accepted in ADR 0050: it narrows a
 * password-guessing list, but guessing still meets the same captcha and limits.
 *
 * It sits behind the same captcha (see `auth-captcha.ts`) and has its own rate
 * limit. Its answer carries a captcha pass for the sign-in code that follows.
 */
export function signUpEmailStatus() {
  return {
    id: "sign-up-email-status",
    endpoints: {
      signUpEmailStatus: createAuthEndpoint(
        SIGN_UP_EMAIL_STATUS_PATH,
        {
          method: "POST",
          body: z.object({ email: z.email() }),
        },
        async (ctx) => {
          const email = ctx.body.email.toLowerCase();
          const found = await ctx.context.internalAdapter.findUserByEmail(
            email,
            { includeAccounts: true },
          );
          return ctx.json({
            exists: Boolean(found?.user),
            hasPassword: Boolean(
              found?.accounts.some(
                (account) =>
                  account.providerId === "credential" && account.password,
              ),
            ),
            captchaPass: await issueCaptchaPass(ctx.context, email),
          });
        },
      ),
    },
    rateLimit: [
      {
        pathMatcher: (path: string) => path === SIGN_UP_EMAIL_STATUS_PATH,
        window: 60,
        max: 10,
      },
    ],
  } satisfies BetterAuthPlugin;
}
