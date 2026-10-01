import type { BetterAuthPlugin } from "better-auth";
import { createAuthEndpoint } from "better-auth/api";
import * as z from "zod";

export const SIGN_UP_EMAIL_STATUS_PATH = "/sign-up/email-status";

/**
 * Tells the first sign-up step whether an email already has an account, so a
 * person who has one is sent to sign-in before typing a name and a password.
 *
 * `/sign-up/email` answers the same question with "User already exists", so
 * this discloses nothing new. It does answer it without creating an account,
 * which makes it the cheaper thing to probe: it sits behind the same captcha
 * (see `auth-captcha.ts`) and has its own rate limit.
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
          );
          return ctx.json({ exists: Boolean(found?.user) });
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
