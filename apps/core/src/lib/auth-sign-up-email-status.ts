import type { BetterAuthPlugin } from "better-auth";
import { createAuthEndpoint } from "better-auth/api";
import * as z from "zod";

export const SIGN_UP_EMAIL_STATUS_PATH = "/sign-up/email-status";

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
 * limit.
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
          const found = await ctx.context.internalAdapter.findUserByEmail(
            ctx.body.email.toLowerCase(),
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
