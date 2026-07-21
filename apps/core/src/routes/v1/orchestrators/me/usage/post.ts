import { createRoute } from "@hono/zod-openapi";
import { Prisma } from "@sokosumi/database";
import {
  type Consumption,
  creditBucketRepository,
} from "@sokosumi/database/repositories";
import { convertCentsToCredits, convertCreditsToCents } from "@sokosumi/utils";

import { badRequest, conflict } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { requireActiveOrchestratorForUser } from "@/helpers/orchestrator-instance";
import { created, ok } from "@/helpers/response";
import { serializableTransaction } from "@/lib/db/transaction";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireOrchestratorAuthContext } from "@/middleware/auth";
import { orchestratorUsageSchema } from "@/schemas/orchestrator-usage.schema";

import { createOrchestratorUsageRequestSchema } from "./schema";

const route = createRoute({
  method: "post",
  path: "/me/usage",
  description:
    "Create usage for the orchestrator instance of the user in the body",
  tags: ["Orchestrators"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: createOrchestratorUsageRequestSchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(orchestratorUsageSchema, "Retrieve usage"),
    201: jsonSuccessResponse(orchestratorUsageSchema, "Create usage"),
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
  orchestratorId: string;
  userId: string;
  organizationId: string | null;
  cents: bigint;
  transactionId: string;
}) {
  return orchestratorUsageSchema.parse({
    id: usage.id,
    createdAt: usage.createdAt,
    updatedAt: usage.updatedAt,
    idempotencyKey: usage.idempotencyKey,
    referenceId: usage.referenceId,
    orchestratorId: usage.orchestratorId,
    userId: usage.userId,
    organizationId: usage.organizationId,
    credits: convertCentsToCredits(usage.cents),
    transactionId: usage.transactionId,
  });
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
    requireOrchestratorAuthContext(c.var.authContext);
    const { credits, idempotencyKey, referenceId, userId, organizationId } =
      c.req.valid("json");

    const result = await serializableTransaction(async (tx) => {
      const orchestrator = await requireActiveOrchestratorForUser(userId, tx);
      const orchestratorId = orchestrator.id;

      const existing = await tx.orchestratorUsage.findUnique({
        where: {
          orchestratorId_idempotencyKey: {
            orchestratorId,
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

      const usage = await tx.orchestratorUsage.create({
        data: {
          idempotencyKey,
          referenceId: referenceId ?? null,
          orchestratorId,
          userId,
          organizationId,
          cents,
          transactionId: transaction.id,
        },
      });

      return { usage, created: true };
    }, "Usage recording conflicted with a concurrent request. Please retry.");

    if (result.created) {
      return created(c, serializeUsage(result.usage));
    }
    return ok(c, serializeUsage(result.usage));
  });
}
