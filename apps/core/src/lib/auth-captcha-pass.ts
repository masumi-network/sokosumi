import type { GenericEndpointContext } from "better-auth";
import { generateRandomString } from "better-auth/crypto";

/**
 * A captcha pass lets the sign-in code sent right after the email step skip a
 * second captcha, so a visitor Cloudflare wants to see is asked once, not
 * twice. `/sign-up/email-status` issues it for one address; the captcha
 * plugin (`auth-captcha.ts`) takes it in place of a Turnstile token on that
 * address's sign-in code send, once, within ten minutes.
 */

// On the wire: Turnstile tokens never start with it, so Core tells a pass
// from a token.
const CAPTCHA_PASS_PREFIX = "pass_";
// Long enough for a person to read the "no account" notice and follow it.
const CAPTCHA_PASS_TTL_MS = 10 * 60 * 1_000;

/** In storage: every pass's verification row starts with it; the purge sync relies on it. */
export const CAPTCHA_PASS_IDENTIFIER_PREFIX = "captcha-pass:";

type VerificationStore = Pick<
  GenericEndpointContext["context"],
  "internalAdapter"
>;

function captchaPassIdentifier(id: string) {
  return `${CAPTCHA_PASS_IDENTIFIER_PREFIX}${id}`;
}

export function isCaptchaPass(value: string) {
  return value.startsWith(CAPTCHA_PASS_PREFIX);
}

export async function issueCaptchaPass(
  context: VerificationStore,
  email: string,
) {
  const id = generateRandomString(32);
  await context.internalAdapter.createVerificationValue({
    identifier: captchaPassIdentifier(id),
    value: email,
    expiresAt: new Date(Date.now() + CAPTCHA_PASS_TTL_MS),
  });
  return `${CAPTCHA_PASS_PREFIX}${id}`;
}

/** Whether `pass` was issued for `email`, using it up either way. */
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
