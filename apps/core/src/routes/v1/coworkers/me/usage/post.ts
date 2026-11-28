import { createRoute } from "@hono/zod-openapi";
import { Prisma } from "@sokosumi/database";
import { InsufficientBalanceError } from "@sokosumi/database/repositories";
import { convertCentsToCredits, convertCreditsToCents } from "@sokosumi/utils";
import { waitUntil } from "@vercel/functions";
import { HTTPException } from "hono/http-exception";

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
import type { NetworkScope } from "@/lib/db/network-scope";
import { serializableTransaction } from "@/lib/db/transaction";
import { runAsBackgroundWork } from "@/lib/evlog";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireCoworkerAuthContext } from "@/middleware/auth";
import { paymentScope } from "@/middleware/network-scope";
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

function serializeUsage(usage: {
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
}) {
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

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const authContext = requireCoworkerAuthContext(c.var.authContext);
    await requireCoworkerCapability(authContext.coworkerId, "tasks");
    const { credits, idempotencyKey, referenceId, userId, organizationId } =
      c.req.valid("json");
    const coworkerId = authContext.coworkerId;

    const result = await serializableTransaction(async (tx) => {
      const existing = await tx.coworkerUsage.findUnique({
        where: {
          coworkerId_idempotencyKey: {
            coworkerId,
            idempotencyKey,
          },
        },
      });

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

      const usage = await tx.coworkerUsage.create({
        data: {
          idempotencyKey,
          referenceId: referenceId ?? null,
          cents,
          coworker: { connect: { id: coworkerId } },
          user: { connect: { id: userId } },
          ...(organizationId
            ? {
                organization: { connect: { id: organizationId } },
              }
            : {}),
          transaction: { connect: { id: transactionId } },
        },
      });

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
