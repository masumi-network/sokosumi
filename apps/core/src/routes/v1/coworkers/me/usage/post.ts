import { createRoute } from "@hono/zod-openapi";
import type { Prisma } from "@sokosumi/database";
import { PrismaRaw } from "@sokosumi/database/client";
import { InsufficientBalanceError } from "@sokosumi/database/repositories";
import { convertCentsToCredits, convertCreditsToCents } from "@sokosumi/utils";
import { waitUntil } from "@vercel/functions";
import { HTTPException } from "hono/http-exception";
import { v7 as uuidv7 } from "uuid";

import { requireCoworkerCapability } from "@/helpers/access-control";
import { notifyLowBalanceAfterCharge } from "@/helpers/billing-notifications";
import { assertCoworkerUserContextBinding } from "@/helpers/coworker-user-context-binding";
import { badRequest, conflict } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { requireAssignedOrganizationSeat } from "@/helpers/organization-assigned-seat";
import { created, ok } from "@/helpers/response";
import {
  type SpendResult,
  spend,
  spendFailedInPreparation,
} from "@/lib/credits/spend";
import {
  createNetworkScope,
  type NetworkScope,
  type SharedDb,
} from "@/lib/db/network-scope";
import { serializableTransaction } from "@/lib/db/transaction";
import { runAsBackgroundWork } from "@/lib/evlog";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { isPreprodOn, otherNetwork } from "@/lib/network";
import { requireCoworkerAuthContext } from "@/middleware/auth";
import { namedPaymentScope, paymentScope } from "@/middleware/network-scope";
import { coworkerUsageSchema } from "@/schemas/coworker-usage.schema";

import { createCoworkerUsageRequestSchema } from "./schema";

const route = createRoute({
  method: "post",
  path: "/me/usage",
  description:
    "Create usage for the current coworker. Bills `userId` only when the coworker is bound to that user's workspace: a granted vendor workspace grant, or an assigned or same-vendor sibling task owned by the user. A denied or revoked grant always rejects.",
  tags: ["Coworkers"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: createCoworkerUsageRequestSchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(coworkerUsageSchema, "Retrieve usage"),
    201: jsonSuccessResponse(coworkerUsageSchema, "Create usage"),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    409: jsonErrorResponse("Conflict"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

interface UsageRow {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  idempotencyKey: string;
  referenceId: string | null;
  coworkerId: string;
  userId: string;
  organizationId: string | null;
  cents: bigint;
  transactionId: string;
}

function serializeUsage(usage: UsageRow) {
  return {
    ...usage,
    credits: convertCentsToCredits(usage.cents),
  };
}

/**
 * Spends the payer's pool for the usage, a price of zero as a debit of zero.
 * Every failure to choose the credits is the route's 400 with its text, as
 * before the module: missing credits, a plan or Seat read, a conflict (whose
 * text the retry around the transaction still knows). A scope that refuses
 * its Network is not one: its 403 passes, and so does a failed write.
 */
async function spendUsage(input: {
  scope: NetworkScope;
  tx: Prisma.TransactionClient;
  userId: string;
  organizationId: string | null;
  cents: bigint;
}): Promise<string> {
  const { scope, tx, userId, organizationId, cents } = input;
  let charge: SpendResult<"in_full_or_zero">;
  try {
    charge = await spend({
      scope,
      tx,
      kind: "coworker_usage",
      payer: { userId, organizationId, projectId: null },
      quotedCents: cents,
      mode: "in_full_or_zero",
    });
  } catch (error) {
    // `@sokosumi/database` throws no HTTPException: only the scope's refusal is one.
    if (
      spendFailedInPreparation(error) &&
      error instanceof Error &&
      !(error instanceof HTTPException)
    ) {
      throw badRequest(error.message);
    }
    throw error;
  }
  if (charge.outcome === "not_charged") {
    throw badRequest(
      new InsufficientBalanceError(charge.quotedCents, charge.availableCents)
        .message,
    );
  }
  return charge.transactionId;
}

// The model's columns in its field order, as Prisma returned the row.
const USAGE_COLUMNS = PrismaRaw.sql`id, "createdAt", "updatedAt", "idempotencyKey", "referenceId", "coworkerId", "userId", "organizationId", cents, "transactionId"`;

/** The Coworker's usage under this key on the scope's Network, if any. */
async function findUsage(
  scope: NetworkScope,
  tx: SharedDb,
  coworkerId: string,
  idempotencyKey: string,
): Promise<UsageRow | undefined> {
  const rows = await tx.$queryRaw<UsageRow[]>`
    SELECT ${USAGE_COLUMNS}
    FROM ${scope.networkTable("coworker_usage")}
    WHERE "coworkerId" = ${coworkerId} AND "idempotencyKey" = ${idempotencyKey}
  `;
  return rows[0];
}

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const authContext = requireCoworkerAuthContext(c.var.authContext);
    // The Network the call names, before any read: its replay is looked up
    // there. Preprod while it is off is refused here.
    const named = namedPaymentScope(c);
    await requireCoworkerCapability(authContext.coworkerId, "tasks");
    const { credits, idempotencyKey, referenceId, userId, organizationId } =
      c.req.valid("json");
    const coworkerId = authContext.coworkerId;

    const result = await serializableTransaction(async (tx) => {
      const existing = await findUsage(named, tx, coworkerId, idempotencyKey);

      // A replay moves no credits and returns only this coworker's own row,
      // so it skips the binding check: a vendor retrying after a timeout
      // must learn whether the charge landed even if the grant was revoked
      // in between.
      if (existing) {
        const requestedCents = convertCreditsToCents(credits);

        if (existing.userId !== userId) {
          throw conflict("Idempotency key already used with different user id");
        }
        if (existing.cents !== requestedCents) {
          throw conflict(
            "Idempotency key already used with different parameters",
          );
        }
        if (existing.referenceId !== (referenceId ?? null)) {
          throw conflict(
            "Idempotency key already used with different reference id",
          );
        }
        if (existing.organizationId !== organizationId) {
          throw conflict(
            "Idempotency key already used with different organization id",
          );
        }

        return { usage: existing, created: false as const };
      }

      // A key used on the other Network is a final conflict, before any money
      // moves. Both reads are in this serializable transaction, so of two
      // first uses on the two Networks at once only one commits; the other's
      // retry finds its row here.
      if (isPreprodOn()) {
        const other = createNetworkScope(otherNetwork(named.network));
        if (await findUsage(other, tx, coworkerId, idempotencyKey)) {
          throw conflict("Idempotency key already used on the other Network");
        }
      }

      if (organizationId !== null) {
        const member = await tx.member.findUnique({
          where: {
            userId_organizationId: {
              userId,
              organizationId,
            },
          },
          select: { userId: true },
        });

        if (!member) {
          throw badRequest(
            "User is not a member of the specified organization",
          );
        }
      }

      // Same `tx`, so a serializable retry re-checks the grant.
      await assertCoworkerUserContextBinding(
        authContext,
        { userId, organizationId },
        tx,
      );

      await requireAssignedOrganizationSeat(userId, organizationId, tx);

      // The Network of the charge: a call that names Preprod is refused or
      // spends Preprod's credits, never Mainnet's.
      const scope = await paymentScope(c, {
        billed: { userId, organizationId },
        db: tx,
      });
      const cents = convertCreditsToCents(credits);
      const transactionId = await spendUsage({
        scope,
        tx,
        userId,
        organizationId,
        cents,
      });

      // On the debit's Network, in its transaction. The id and times as
      // Prisma's create made them: the `uuid` package's v7 (ordered within a
      // millisecond in this process), taken before the time, so its time is
      // never after `createdAt`; the times after the debit's.
      const id = uuidv7();
      const now = new Date();
      const [usage] = await tx.$queryRaw<UsageRow[]>`
        INSERT INTO ${scope.networkTable("coworker_usage")} (${USAGE_COLUMNS})
        VALUES (${id}, ${now}, ${now}, ${idempotencyKey}, ${referenceId ?? null}, ${coworkerId}, ${userId}, ${organizationId}, ${cents}, ${transactionId})
        RETURNING ${USAGE_COLUMNS}
      `;
      if (!usage) throw new Error("The usage insert returned no row");

      return { usage, created: true as const, scope };
    }, "Usage recording conflicted with a concurrent request. Please retry.");

    const response = serializeUsage(result.usage);

    if (result.created) {
      waitUntil(
        runAsBackgroundWork(() =>
          notifyLowBalanceAfterCharge(
            {
              userId,
              organizationId: organizationId ?? null,
            },
            result.scope,
          ),
        ),
      );
      return created(c, coworkerUsageSchema.parse(response));
    }

    return ok(c, coworkerUsageSchema.parse(response));
  });
}
