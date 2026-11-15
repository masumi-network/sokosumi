import { createHash } from "node:crypto";
import {
  getCurrentAdapter,
  runWithTransaction,
} from "@better-auth/core/context";
import type { BetterAuthPlugin, DBAdapter } from "better-auth";
import {
  APIError,
  createAuthEndpoint,
  createAuthMiddleware,
  getSessionFromCtx,
  sensitiveSessionMiddleware,
  sessionMiddleware,
} from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { generateRandomString, signJWT, verifyJWT } from "better-auth/crypto";
import * as z from "zod";

export const REQUEST_EMAIL_CHANGE_PATH = "/email-change/request";
export const CONFIRM_EMAIL_CHANGE_PATH = "/email-change/confirm";
export const EMAIL_CHANGE_STATUS_PATH = "/email-change/status";
export const CANCEL_EMAIL_CHANGE_PATH = "/email-change/cancel";
export const ACKNOWLEDGE_EMAIL_CHANGE_PATH = "/email-change/acknowledge";

/** Marks the links this module signs, so no other token is read as one. */
const LINK_PURPOSE = "sokosumi-email-change";
const MODEL = "verification";
/** How long the account page may still say "Your email is now …". */
const COMPLETED_TTL_SECONDS = 10 * 60;

/**
 * A fixed row id per person, shaped as a UUID because Core makes Better Auth
 * generate UUID ids (`generateId: "uuid"`), and with that set the adapter
 * replaces any other id it is given.
 */
function rowId(name: string): string {
  const hex = createHash("sha256").update(name).digest("hex");
  // Version 5 and RFC 4122 variant bits, as a name-based UUID.
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `${((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}
const pendingName = (userId: string) => `pending-email-change:${userId}`;
const completedName = (userId: string) => `email-change-done:${userId}`;
const pendingRowId = (userId: string) => rowId(pendingName(userId));
const completedRowId = (userId: string) => rowId(completedName(userId));

/** The adapter calls this module makes; any Better Auth adapter has them. */
type Adapter = Pick<
  DBAdapter,
  "create" | "deleteMany" | "findOne" | "updateMany"
>;

interface Row {
  value: string;
  expiresAt: Date;
}

/**
 * The stored request. `generation` is fresh and random per request and is
 * signed into its link, so no two requests share a link, even within one
 * second.
 */
const requestValue = (target: string, generation: string) =>
  JSON.stringify({ target, generation });

async function readTarget(adapter: Adapter, id: string) {
  const row = await adapter.findOne<Row>({
    model: MODEL,
    where: [{ field: "id", value: id }],
  });
  if (!row || new Date(row.expiresAt) < new Date()) return null;
  return (JSON.parse(row.value) as { target: string }).target;
}

/** Replaces the named row, whatever it holds. */
async function putRow(
  adapter: Adapter,
  name: string,
  value: string,
  expiresInSeconds: number,
): Promise<void> {
  const update = {
    value,
    expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
    updatedAt: new Date(),
  };
  const id = rowId(name);
  const where = [{ field: "id", value: id }];
  if ((await adapter.updateMany({ model: MODEL, where, update })) > 0) return;
  try {
    await adapter.create({
      model: MODEL,
      data: { id, identifier: name, createdAt: new Date(), ...update },
      forceAllowId: true,
    });
  } catch (error) {
    // Another request created the row first: replace it instead.
    if ((await adapter.updateMany({ model: MODEL, where, update })) === 0) {
      throw error;
    }
  }
}

const linkClaims = z.object({
  purpose: z.literal(LINK_PURPOSE),
  userId: z.string(),
  email: z.string(),
  updateTo: z.string(),
  generation: z.string(),
});

/**
 * Email change with a pending request that can be shown, sent again and
 * cancelled. Better Auth's own change link has no server record, so it can be
 * neither shown nor taken back; Core disables `/change-email` and uses this.
 *
 * Each person has at most one request: one `verification` row with a fixed
 * id. A new request replaces it, so every older link stops working. Opening
 * a link deletes the row matching that link's generation and changes the
 * email in one database transaction. Cancelling deletes the same row. The
 * row lock orders the two: a cancel that removed the row stops the change,
 * and a cancel after the change removes nothing and says so.
 *
 * The change also writes a completion row in that transaction; the account
 * page reads it before it says the email changed.
 *
 * An address that already has an account gets a request with no mail, as in
 * Better Auth: answering differently would tell the person it is taken.
 */
export function pendingEmailChange({
  expiresIn,
  accountUrl,
}: {
  /** Seconds a link stays valid. */
  expiresIn: number;
  /** Absolute account page URL; every link returns there. */
  accountUrl: string;
}) {
  return {
    id: "pending-email-change",
    endpoints: {
      requestEmailChange: createAuthEndpoint(
        REQUEST_EMAIL_CHANGE_PATH,
        {
          method: "POST",
          body: z.object({ newEmail: z.email() }),
          use: [sensitiveSessionMiddleware],
        },
        async (ctx) => {
          const { user } = ctx.context.session;
          const target = ctx.body.newEmail.toLowerCase();
          if (target === user.email.toLowerCase()) {
            throw APIError.fromStatus("BAD_REQUEST", {
              message: "Email is the same",
            });
          }
          const send =
            ctx.context.options.emailVerification?.sendVerificationEmail;
          if (!send) {
            throw APIError.fromStatus("BAD_REQUEST", {
              message: "Verification email isn't enabled",
            });
          }
          const generation = generateRandomString(32);
          await putRow(
            ctx.context.adapter,
            pendingName(user.id),
            requestValue(target, generation),
            expiresIn,
          );
          if (await ctx.context.internalAdapter.findUserByEmail(target)) {
            return ctx.json({ status: true });
          }
          const token = await signJWT(
            {
              purpose: LINK_PURPOSE,
              userId: user.id,
              email: user.email.toLowerCase(),
              updateTo: target,
              generation,
            },
            ctx.context.secret,
            expiresIn,
          );
          await send(
            {
              user: { ...user, email: target },
              url: `${ctx.context.baseURL}${CONFIRM_EMAIL_CHANGE_PATH}?token=${token}`,
              token,
            },
            ctx.request,
          );
          return ctx.json({ status: true });
        },
      ),
      confirmEmailChange: createAuthEndpoint(
        CONFIRM_EMAIL_CHANGE_PATH,
        { method: "GET", query: z.object({ token: z.string() }) },
        async (ctx) => {
          const done = new URL(accountUrl);
          done.searchParams.set("emailChange", "1");
          const refuse = () => {
            done.searchParams.set("error", "INVALID_TOKEN");
            return ctx.redirect(done.toString());
          };

          const claims = linkClaims.safeParse(
            await verifyJWT(ctx.query.token, ctx.context.secret),
          );
          if (!claims.success) throw refuse();
          const { userId, email, updateTo, generation } = claims.data;
          const session = await getSessionFromCtx(ctx);
          if (session && session.user.id !== userId) throw refuse();

          const applied = await runWithTransaction(
            ctx.context.adapter,
            async () => {
              const adapter = await getCurrentAdapter(ctx.context.adapter);
              const consumed = await adapter.deleteMany({
                model: MODEL,
                where: [
                  { field: "id", value: pendingRowId(userId) },
                  { field: "value", value: requestValue(updateTo, generation) },
                  { field: "expiresAt", operator: "gt", value: new Date() },
                ],
              });
              if (consumed === 0) return false;
              const user =
                await ctx.context.internalAdapter.findUserById(userId);
              if (
                user?.email.toLowerCase() !== email ||
                (await ctx.context.internalAdapter.findUserByEmail(updateTo))
              ) {
                return false;
              }
              await ctx.context.internalAdapter.updateUser(userId, {
                email: updateTo,
                emailVerified: true,
              });
              await putRow(
                adapter,
                completedName(userId),
                JSON.stringify({ target: updateTo }),
                COMPLETED_TTL_SECONDS,
              );
              return true;
            },
          );
          if (!applied) throw refuse();

          if (session) {
            await setSessionCookie(ctx, {
              session: session.session,
              user: { ...session.user, email: updateTo, emailVerified: true },
            });
          }
          throw ctx.redirect(done.toString());
        },
      ),
      getEmailChangeStatus: createAuthEndpoint(
        EMAIL_CHANGE_STATUS_PATH,
        { method: "GET", use: [sessionMiddleware] },
        async (ctx) => {
          const userId = ctx.context.session.user.id;
          const pending = await readTarget(
            ctx.context.adapter,
            pendingRowId(userId),
          );
          const completed = await readTarget(
            ctx.context.adapter,
            completedRowId(userId),
          );
          return ctx.json({
            pending: pending ? { newEmail: pending } : null,
            completed: completed ? { newEmail: completed } : null,
          });
        },
      ),
      cancelEmailChange: createAuthEndpoint(
        CANCEL_EMAIL_CHANGE_PATH,
        { method: "POST", use: [sessionMiddleware] },
        async (ctx) => {
          const removed = await ctx.context.adapter.deleteMany({
            model: MODEL,
            where: [
              { field: "id", value: pendingRowId(ctx.context.session.user.id) },
            ],
          });
          // False when a link already applied the change, or none waited.
          return ctx.json({ cancelled: removed > 0 });
        },
      ),
      acknowledgeEmailChange: createAuthEndpoint(
        ACKNOWLEDGE_EMAIL_CHANGE_PATH,
        { method: "POST", use: [sessionMiddleware] },
        async (ctx) => {
          await ctx.context.adapter.deleteMany({
            model: MODEL,
            where: [
              {
                field: "id",
                value: completedRowId(ctx.context.session.user.id),
              },
            ],
          });
          return ctx.json({ status: true });
        },
      ),
    },
    hooks: {
      before: [
        {
          // Links Better Auth issued before `/change-email` was disabled
          // cannot be cancelled, so they no longer change anything.
          matcher: (ctx) => ctx.path === "/verify-email",
          handler: createAuthMiddleware(async (ctx) => {
            const payload = String(ctx.query?.token ?? "").split(".")[1];
            let requestType: unknown;
            try {
              requestType = JSON.parse(
                Buffer.from(payload ?? "", "base64url").toString("utf8"),
              ).requestType;
            } catch {
              return;
            }
            if (
              requestType === "change-email-verification" ||
              requestType === "change-email-confirmation"
            ) {
              return { context: { query: { ...ctx.query, token: "refused" } } };
            }
          }),
        },
      ],
    },
    rateLimit: [
      {
        pathMatcher: (path: string) => path === REQUEST_EMAIL_CHANGE_PATH,
        window: 60,
        max: 5,
      },
    ],
  } satisfies BetterAuthPlugin;
}
