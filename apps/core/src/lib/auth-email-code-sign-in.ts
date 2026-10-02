import { runWithTransaction } from "@better-auth/core/context";
import { EMAIL_CODE_SIGN_IN_METHODS_REMOVED } from "@sokosumi/utils";
import type { BetterAuthPlugin } from "better-auth";
import {
  APIError,
  createAuthEndpoint,
  createAuthMiddleware,
} from "better-auth/api";

import type { emailOTP } from "better-auth/plugins/email-otp";

const EMAIL_CODE_SIGN_IN_PATH = "/sign-in/email-otp";

// Hands the before hook's finding to the after hook. A context key the request
// body cannot set.
const REMOVES_SIGN_IN_METHODS = "emailCodeSignInRemovesSignInMethods";

function isEmailCodeSignIn(ctx: { path?: string }): boolean {
  return ctx.path === EMAIL_CODE_SIGN_IN_PATH;
}

/**
 * For `lastLoginMethod`: a password sign-up is remembered as `email`, like a
 * password sign-in, though it went through the email code. Sign-in then opens
 * on the password.
 */
export function resolveEmailCodeSignUpLoginMethod(ctx: {
  path?: string;
  body?: { password?: unknown };
}): "email" | null {
  return isEmailCodeSignIn(ctx) && typeof ctx.body?.password === "string"
    ? "email"
    : null;
}

/**
 * Two things around Better Auth's email code sign-in.
 *
 * Password sign-up goes through it. The sign-up page sends the password with
 * the code, so the account is created with its address proven and the
 * password is added once the code is accepted. Plain `/sign-up/email` is
 * closed (`disabledPaths` in `auth.ts`): it created accounts whose address
 * nobody had proven.
 *
 * A code sign-in to an account whose address is unproven deletes its password
 * and provider links (Better Auth's `revokeUnprovenAccountAccess`). That stays,
 * it protects against pre-hijacked accounts, but the response now says so.
 */
export function emailCodeSignIn(emailCode: ReturnType<typeof emailOTP>) {
  const signInEmailOTP = emailCode.endpoints.signInEmailOTP;
  return {
    ...emailCode,
    endpoints: {
      ...emailCode.endpoints,
      signInEmailOTP: createAuthEndpoint(
        signInEmailOTP.path,
        signInEmailOTP.options,
        async (ctx) => {
          if (typeof ctx.body.password !== "string") {
            const result = await signInEmailOTP({
              ...ctx,
              asResponse: false,
              returnHeaders: true,
            });
            ctx.responseHeaders = result.headers;
            return ctx.json(result.response);
          }

          // Hash before writes. The existing endpoint still owns OTP validation
          // and atomic consumption; successful signup and its credential commit together.
          const password = await ctx.context.password.hash(ctx.body.password);
          const internalAdapter = ctx.context.internalAdapter;
          try {
            const result = await runWithTransaction(
              ctx.context.adapter,
              async () => {
                ctx.context.internalAdapter = {
                  ...internalAdapter,
                  // The endpoint looks up the address again after consuming the code.
                  // Refuse a signup collision instead of silently signing in without a password.
                  findUserByEmail: async (...args) => {
                    const found = await internalAdapter.findUserByEmail(
                      ...args,
                    );
                    if (found) {
                      throw new APIError("UNPROCESSABLE_ENTITY", {
                        code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL",
                        message: "User already exists. Use another email.",
                      });
                    }
                    return found;
                  },
                };
                const response = await signInEmailOTP({
                  ...ctx,
                  asResponse: false,
                  returnHeaders: true,
                }).catch((error: unknown) => {
                  // Failed OTP attempts must commit their attempt counter. All later
                  // failures roll back user/session creation and restore the code.
                  if (
                    error instanceof APIError &&
                    [
                      "INVALID_OTP",
                      "OTP_EXPIRED",
                      "TOO_MANY_ATTEMPTS",
                    ].includes(error.body?.code ?? "")
                  ) {
                    return { error };
                  }
                  throw error;
                });
                if ("error" in response) return response;
                const userId = response.response.user.id;
                const account = await internalAdapter.linkAccount({
                  userId,
                  providerId: "credential",
                  accountId: userId,
                  password,
                });
                if (!account)
                  throw new APIError("INTERNAL_SERVER_ERROR", {
                    message: "Failed to create password account",
                  });
                return response;
              },
            );
            if ("error" in result) throw result.error;
            // Publish cookies only after the credential has committed.
            ctx.responseHeaders = result.headers;
            return ctx.json(result.response);
          } catch (error) {
            ctx.context.newSession = null;
            throw error;
          } finally {
            ctx.context.internalAdapter = internalAdapter;
          }
        },
      ),
    },
    id: "email-code-sign-in",
    hooks: {
      before: [
        {
          matcher: isEmailCodeSignIn,
          handler: createAuthMiddleware(async (ctx) => {
            const email =
              typeof ctx.body?.email === "string"
                ? ctx.body.email.toLowerCase()
                : "";
            const password: unknown = ctx.body?.password;
            const found = await ctx.context.internalAdapter.findUserByEmail(
              email,
              { includeAccounts: true },
            );

            if (password !== undefined) {
              const { minPasswordLength, maxPasswordLength } =
                ctx.context.password.config;
              if (
                typeof password !== "string" ||
                password.length < minPasswordLength
              ) {
                throw new APIError("BAD_REQUEST", {
                  code: "PASSWORD_TOO_SHORT",
                  message: "Password too short",
                });
              }
              if (password.length > maxPasswordLength) {
                throw new APIError("BAD_REQUEST", {
                  code: "PASSWORD_TOO_LONG",
                  message: "Password too long",
                });
              }
              // Checked before the code is spent, so it still signs in.
              if (found) {
                throw new APIError("UNPROCESSABLE_ENTITY", {
                  code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL",
                  message: "User already exists. Use another email.",
                });
              }
              return;
            }

            return {
              context: {
                [REMOVES_SIGN_IN_METHODS]: Boolean(
                  found &&
                    !found.user.emailVerified &&
                    found.accounts.length > 0,
                ),
              },
            };
          }),
        },
      ],
      after: [
        ...emailCode.hooks.after,
        {
          matcher: isEmailCodeSignIn,
          handler: createAuthMiddleware(async (ctx) => {
            const newSession = ctx.context.newSession;
            const returned = ctx.context.returned;
            // An earlier after hook may have refused the sign-in, e.g. Core's
            // terms check.
            if (
              !newSession ||
              returned instanceof APIError ||
              typeof returned !== "object" ||
              returned === null
            ) {
              return;
            }

            if (
              REMOVES_SIGN_IN_METHODS in ctx &&
              ctx[REMOVES_SIGN_IN_METHODS] === true
            ) {
              return ctx.json({
                ...returned,
                [EMAIL_CODE_SIGN_IN_METHODS_REMOVED]: true,
              });
            }
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}
