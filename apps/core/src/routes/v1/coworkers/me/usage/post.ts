import { createRoute } from "@hono/zod-openapi";
import { Prisma } from "@sokosumi/database";
import {
  type Consumption,
  creditBucketRepository,
} from "@sokosumi/database/repositories";
import { convertCentsToCredits, convertCreditsToCents } from "@sokosumi/utils";

import { requireCoworkerCapability } from "@/helpers/access-control";
import { badRequest, conflict } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { requireOrganizationWorkstation } from "@/helpers/organization-workstation";
import { created, ok } from "@/helpers/response";
import { serializableTransaction } from "@/lib/db/transaction";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireCoworkerAuthContext } from "@/middleware/auth";
import { coworkerUsageSchema } from "@/schemas/coworker-usage.schema";

import { createCoworkerUsageRequestSchema } from "./schema";

const route = createRoute({
  method: "post",
  path: "/me/usage",
  description: "Create usage for the current coworker",
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

async function prepareConsumptions(
  userId: string,
  organizationId: string | null,
  cents: bigint,
  tx: Prisma.TransactionClient,
): Promise<Consumption[]> {
  if (cents <= 0n) {
    return [];
  }

  try {
    return await creditBucketRepository.prepareConsumption(
      userId,
      organizationId,
      cents,
      tx,
    );
  } catch (error) {
    if (error instanceof Error) {
      throw badRequest(error.message);
    }
    throw error;
  }
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

        return { usage: existing, created: false };
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

      await requireOrganizationWorkstation(userId, organizationId, tx);

      const cents = convertCreditsToCents(credits);
      const consumptions = await prepareConsumptions(
        userId,
        organizationId,
        cents,
        tx,
      );

      const transaction = await tx.transaction.create({
        data: {
          amount: cents * BigInt(-1),
          user: { connect: { id: userId } },
          ...(organizationId
            ? {
                organization: { connect: { id: organizationId } },
              }
            : {}),
          creditConsumptions: {
            createMany: {
              data: consumptions.map((consumption) => ({
                bucketId: consumption.bucketId,
                amount: consumption.amount,
              })),
            },
          },
        },
        select: {
          id: true,
        },
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
          transaction: { connect: { id: transaction.id } },
        },
      });

      return { usage, created: true };
    }, "Usage recording conflicted with a concurrent request. Please retry.");

    const response = serializeUsage(result.usage);

    if (result.created) {
      return created(c, coworkerUsageSchema.parse(response));
    }

    return ok(c, coworkerUsageSchema.parse(response));
  });
}
