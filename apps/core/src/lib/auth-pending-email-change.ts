import { createHash } from "node:crypto";
import type { BetterAuthPlugin, DBAdapter } from "better-auth";
import {
  APIError,
  createAuthEndpoint,
  createAuthMiddleware,
  sessionMiddleware,
} from "better-auth/api";
import { verifyJWT } from "better-auth/crypto";

export const EMAIL_CHANGE_STATUS_PATH = "/change-email/status";
export const CANCEL_EMAIL_CHANGE_PATH = "/change-email/cancel";
export const ACKNOWLEDGE_EMAIL_CHANGE_PATH = "/change-email/acknowledge";

const CHANGE_EMAIL_PATH = "/change-email";
const VERIFY_EMAIL_PATH = "/verify-email";
const CHANGE_EMAIL_VERIFICATION = "change-email-verification";
const MODEL = "verification";
/** How long the account page may still say "Your email is now …". */
const COMPLETED_TTL_SECONDS = 10 * 60;
/**
 * A link being applied holds its request this long. A crash between claim
 * and release leaves the request usable again afterwards.
 */
export const CLAIM_TTL_MS = 60_000;

/**
 * One row per person, so the primary key makes every write to it a
 * compare-and-swap on a single row: no lock, and safe across Core instances.
 */
const pendingRowId = (userId: string) => `pending-email-change:${userId}`;
const completedRowId = (userId: string) => `email-change-done:${userId}`;

interface EmailChangeRecord {
  target: string;
  /** SHA-256 of the one link that may apply the request; null: no link. */
  tokenHash: string | null;
  /** When a link started applying the request; null while it waits. */
  claimedAt: number | null;
}

interface Row {
  id: string;
  value: string;
  expiresAt: Date;
}

/** The adapter calls this module makes; any Better Auth adapter has them. */
type Adapter = Pick<
  DBAdapter,
  "create" | "deleteMany" | "findOne" | "updateMany"
>;

const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

function parseRecord(row: Row | null): EmailChangeRecord | null {
  if (!row || new Date(row.expiresAt) < new Date()) return null;
  try {
    return JSON.parse(row.value) as EmailChangeRecord;
  } catch {
    return null;
  }
}

const isClaimed = (record: EmailChangeRecord) =>
  record.claimedAt !== null && Date.now() - record.claimedAt < CLAIM_TTL_MS;

function findRow(adapter: Adapter, id: string): Promise<Row | null> {
  return adapter.findOne<Row>({
    model: MODEL,
    where: [{ field: "id", value: id }],
  });
}

/** Replaces the row, whatever it holds. */
async function putRow(
  adapter: Adapter,
  id: string,
  record: EmailChangeRecord,
  expiresInSeconds: number,
): Promise<void> {
  const update = {
    value: JSON.stringify(record),
    expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
    updatedAt: new Date(),
  };
  const where = [{ field: "id", value: id }];
  if ((await adapter.updateMany({ model: MODEL, where, update })) > 0) return;
  try {
    await adapter.create({
      model: MODEL,
      data: { id, identifier: id, createdAt: new Date(), ...update },
      forceAllowId: true,
    });
  } catch (error) {
    // Another request created the row first: replace it instead.
    if ((await adapter.updateMany({ model: MODEL, where, update })) === 0) {
      throw error;
    }
  }
}

/** Replaces or deletes the row only while it still holds what was read. */
async function swapRow(
  adapter: Adapter,
  row: Row,
  next: EmailChangeRecord | null,
): Promise<boolean> {
  const where = [
    { field: "id", value: row.id },
    { field: "value", value: row.value },
  ];
  const changed =
    next === null
      ? await adapter.deleteMany({ model: MODEL, where })
      : await adapter.updateMany({
          model: MODEL,
          where,
          update: { value: JSON.stringify(next), updatedAt: new Date() },
        });
  return changed > 0;
}

interface ChangeLinkClaims {
  updateTo: string;
  userId: string;
}

/** The claims of a change link, read without checking its signature. */
function peekChangeLink(token: unknown): ChangeLinkClaims | null {
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
 * Records the link Better Auth is about to mail for an email change, which
 * retires every earlier link. Call it from
 * `emailVerification.sendVerificationEmail` before sending: Better Auth hands
 * out the link's token nowhere else. Other links are ignored.
 */
export async function recordEmailChangeLink(
  getContext: () => Promise<{ adapter: Adapter }>,
  token: string,
  expiresInSeconds: number,
): Promise<void> {
  const claims = peekChangeLink(token);
  if (!claims) return;
  await putRow(
    (await getContext()).adapter,
    pendingRowId(claims.userId),
    { target: claims.updateTo, tokenHash: hashToken(token), claimedAt: null },
    expiresInSeconds,
  );
}

/**
 * Better Auth's change link is a signed token with no server record, so
 * nothing could show a change as waiting or take it back. This plugin keeps
 * the one request a person has open: its address and the hash of the one
 * link that may apply it.
 *
 * - A new request replaces the row, so every older link stops working, even
 *   one for the same address.
 * - Cancelling deletes the row, unless a link is being applied right now:
 *   then it answers 409 rather than report a cancel that did not happen.
 * - Opening a link checks its signature, then claims the row by
 *   compare-and-swap. Only the claimer goes on to change the email, and it
 *   releases only its own claim, so a newer request survives.
 * - A change that went through leaves a short-lived completion row. The
 *   account page reads it before it says the email changed.
 *
 * An address that already has an account gets a row too, with no link,
 * though Better Auth mails nothing there: showing nothing would tell the
 * person the address is taken.
 */
export function pendingEmailChange({ expiresIn }: { expiresIn: number }) {
  return {
    id: "pending-email-change",
    endpoints: {
      getEmailChangeStatus: createAuthEndpoint(
        EMAIL_CHANGE_STATUS_PATH,
        { method: "GET", use: [sessionMiddleware] },
        async (ctx) => {
          const userId = ctx.context.session.user.id;
          const pending = parseRecord(
            await findRow(ctx.context.adapter, pendingRowId(userId)),
          );
          const completed = parseRecord(
            await findRow(ctx.context.adapter, completedRowId(userId)),
          );
          return ctx.json({
            pending: pending ? { newEmail: pending.target } : null,
            completed: completed ? { newEmail: completed.target } : null,
          });
        },
      ),
      cancelEmailChange: createAuthEndpoint(
        CANCEL_EMAIL_CHANGE_PATH,
        { method: "POST", use: [sessionMiddleware] },
        async (ctx) => {
          const id = pendingRowId(ctx.context.session.user.id);
          // A retry covers a request replaced between the read and the swap.
          for (let attempt = 0; attempt < 3; attempt++) {
            const row = await findRow(ctx.context.adapter, id);
            if (!row) return ctx.json({ status: true });
            const record = parseRecord(row);
            if (record && isClaimed(record)) break;
            if (await swapRow(ctx.context.adapter, row, null)) {
              return ctx.json({ status: true });
            }
          }
          throw APIError.from("CONFLICT", {
            code: "EMAIL_CHANGE_IN_PROGRESS",
            message: "The email change is being confirmed right now.",
          });
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
          matcher: (ctx) => ctx.path === VERIFY_EMAIL_PATH,
          handler: createAuthMiddleware(async (ctx) => {
            const token = ctx.query?.token;
            const claims = peekChangeLink(token);
            // Not a change link, or a forged or expired one: Better Auth
            // refuses those itself, and nothing is claimed for them.
            if (
              !claims ||
              !(await verifyJWT(token as string, ctx.context.secret))
            ) {
              return;
            }
            const row = await findRow(
              ctx.context.adapter,
              pendingRowId(claims.userId),
            );
            const record = parseRecord(row);
            const claimed =
              row !== null &&
              record !== null &&
              record.tokenHash === hashToken(token as string) &&
              !isClaimed(record) &&
              (await swapRow(ctx.context.adapter, row, {
                ...record,
                claimedAt: Date.now(),
              }));
            if (claimed) return;
            // An unreadable token makes Better Auth refuse the link its own
            // way: after its origin check, back to the callback with
            // `error=INVALID_TOKEN`.
            return {
              context: { query: { ...ctx.query, token: "refused" } },
            };
          }),
        },
      ],
      after: [
        {
          matcher: (ctx) => ctx.path === CHANGE_EMAIL_PATH,
          handler: createAuthMiddleware(async (ctx) => {
            const session = ctx.context.session;
            const newEmail =
              typeof ctx.body?.newEmail === "string"
                ? ctx.body.newEmail.toLowerCase()
                : null;
            if (
              !session ||
              !newEmail ||
              ctx.context.returned instanceof APIError
            ) {
              return;
            }
            // Better Auth mails nothing to an address with an account, so
            // `recordEmailChangeLink` did not run: record the request with
            // no link, so it shows as waiting like any other.
            if (await ctx.context.internalAdapter.findUserByEmail(newEmail)) {
              await putRow(
                ctx.context.adapter,
                pendingRowId(session.user.id),
                { target: newEmail, tokenHash: null, claimedAt: null },
                expiresIn,
              );
            }
          }),
        },
        {
          matcher: (ctx) => ctx.path === VERIFY_EMAIL_PATH,
          handler: createAuthMiddleware(async (ctx) => {
            // A refused link reaches here with its token swapped out, so
            // only a link that claimed its request gets past this.
            const token = ctx.query?.token;
            const claims = peekChangeLink(token);
            if (!claims) return;
            const tokenHash = hashToken(token as string);
            const user = await ctx.context.internalAdapter.findUserById(
              claims.userId,
            );
            const applied = user?.email.toLowerCase() === claims.updateTo;
            if (applied) {
              await putRow(
                ctx.context.adapter,
                completedRowId(claims.userId),
                { target: claims.updateTo, tokenHash, claimedAt: null },
                COMPLETED_TTL_SECONDS,
              );
            }
            const row = await findRow(
              ctx.context.adapter,
              pendingRowId(claims.userId),
            );
            const record = parseRecord(row);
            // Release only this link's own claim; a newer request stays. A
            // change that failed waits again, so the link can be retried.
            if (row && record?.tokenHash === tokenHash && record.claimedAt) {
              await swapRow(
                ctx.context.adapter,
                row,
                applied ? null : { ...record, claimedAt: null },
              );
            }
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}
