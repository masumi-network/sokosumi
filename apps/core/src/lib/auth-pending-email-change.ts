import type { BetterAuthPlugin } from "better-auth";
import {
  createAuthEndpoint,
  createAuthMiddleware,
  isAPIError,
  sessionMiddleware,
} from "better-auth/api";

export const PENDING_EMAIL_CHANGE_PATH = "/change-email/pending";
export const CANCEL_EMAIL_CHANGE_PATH = "/change-email/cancel";

const CHANGE_EMAIL_PATH = "/change-email";
const VERIFY_EMAIL_PATH = "/verify-email";
const CHANGE_EMAIL_VERIFICATION = "change-email-verification";

function pendingIdentifier(userId: string): string {
  return `pending-email-change:${userId}`;
}

interface ChangeEmailClaims {
  updateTo: string;
  userId: string;
}

/**
 * Reads the claims of a change link without checking its signature. Safe
 * only because the result can do no more than refuse a link: `/verify-email`
 * still verifies the signature of every link this lets through.
 */
export function readChangeEmailClaims(
  token: unknown,
): ChangeEmailClaims | null {
  if (typeof token !== "string") return null;
  try {
    const payload: unknown = JSON.parse(
      Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"),
    );
    if (typeof payload !== "object" || payload === null) return null;
    const { requestType, updateTo, userId } = payload as Record<
      string,
      unknown
    >;
    if (
      requestType !== CHANGE_EMAIL_VERIFICATION ||
      typeof updateTo !== "string" ||
      typeof userId !== "string"
    ) {
      return null;
    }
    return { updateTo: updateTo.toLowerCase(), userId };
  } catch {
    return null;
  }
}

/**
 * Better Auth's change link is a signed token with no server record, so
 * nothing could show a change as waiting, and nothing could take it back.
 * This plugin keeps one record per person in the `verification` table for the
 * address they last asked for. Only a link to that address, opened before the
 * record expires, still changes the email: cancelling deletes the record, and
 * asking for another address replaces it, which retires older links.
 *
 * An address that already has an account gets a record too, though Better
 * Auth sends it no mail: showing nothing there would tell the person the
 * address is taken.
 */
export function pendingEmailChange({ expiresIn }: { expiresIn: number }) {
  return {
    id: "pending-email-change",
    endpoints: {
      getPendingEmailChange: createAuthEndpoint(
        PENDING_EMAIL_CHANGE_PATH,
        { method: "GET", use: [sessionMiddleware] },
        async (ctx) => {
          const record =
            await ctx.context.internalAdapter.findVerificationValue(
              pendingIdentifier(ctx.context.session.user.id),
            );
          if (!record || record.expiresAt < new Date()) {
            return ctx.json(null);
          }
          return ctx.json({
            newEmail: record.value,
            expiresAt: record.expiresAt,
          });
        },
      ),
      cancelEmailChange: createAuthEndpoint(
        CANCEL_EMAIL_CHANGE_PATH,
        { method: "POST", use: [sessionMiddleware] },
        async (ctx) => {
          await ctx.context.internalAdapter.deleteVerificationByIdentifier(
            pendingIdentifier(ctx.context.session.user.id),
          );
          return ctx.json({ status: true });
        },
      ),
    },
    hooks: {
      before: [
        {
          matcher: (ctx) => ctx.path === VERIFY_EMAIL_PATH,
          handler: createAuthMiddleware(async (ctx) => {
            const claims = readChangeEmailClaims(ctx.query?.token);
            if (!claims) return;
            const record =
              await ctx.context.internalAdapter.findVerificationValue(
                pendingIdentifier(claims.userId),
              );
            if (
              record &&
              record.value === claims.updateTo &&
              record.expiresAt >= new Date()
            ) {
              return;
            }
            // An unreadable token makes Better Auth refuse the link its own
            // way: after its origin check, back to the callback with
            // `error=INVALID_TOKEN`.
            return {
              context: { query: { ...ctx.query, token: "cancelled" } },
            };
          }),
        },
      ],
      after: [
        {
          matcher: (ctx) => ctx.path === CHANGE_EMAIL_PATH,
          handler: createAuthMiddleware(async (ctx) => {
            const session = ctx.context.session;
            const newEmail = ctx.body?.newEmail;
            if (
              !session ||
              typeof newEmail !== "string" ||
              isAPIError(ctx.context.returned)
            ) {
              return;
            }
            const identifier = pendingIdentifier(session.user.id);
            await ctx.context.internalAdapter.deleteVerificationByIdentifier(
              identifier,
            );
            await ctx.context.internalAdapter.createVerificationValue({
              identifier,
              value: newEmail.toLowerCase(),
              expiresAt: new Date(Date.now() + expiresIn * 1000),
            });
          }),
        },
        {
          matcher: (ctx) => ctx.path === VERIFY_EMAIL_PATH,
          handler: createAuthMiddleware(async (ctx) => {
            const claims = readChangeEmailClaims(ctx.query?.token);
            if (!claims) return;
            // Clear the record once the change happened, whatever the
            // endpoint returned (a success is a redirect, thrown as an error).
            const user = await ctx.context.internalAdapter.findUserById(
              claims.userId,
            );
            if (user?.email.toLowerCase() === claims.updateTo) {
              await ctx.context.internalAdapter.deleteVerificationByIdentifier(
                pendingIdentifier(claims.userId),
              );
            }
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}
