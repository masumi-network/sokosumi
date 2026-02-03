import { createRoute } from "@hono/zod-openapi";
import { Prisma } from "@sokosumi/database";
import {
  convertCentsToCredits,
  convertCreditsToCents,
} from "@sokosumi/database/helpers";
import {
  type Consumption,
  creditBucketRepository,
} from "@sokosumi/database/repositories";

import { badRequest, conflict, forbidden } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created, ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { orchestratorUsageSchema } from "@/schemas/orchestrator-usage.schema";

import { paramsSchema } from "../schema";
import { createOrchestratorUsageRequestSchema } from "./schema";

const route = createRoute({
  method: "post",
  path: "/{id}/usage",
  description: "Create orchestrator usage",
  tags: ["Orchestrators"],
  request: {
    params: paramsSchema,
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
    const { authContext } = c.var;
    const { id } = c.req.valid("param");
    const { credits, idempotencyKey, referenceId } = c.req.valid("json");

    if (!authContext.orchestratorId) {
      throw forbidden("Orchestrator authentication required");
    }

    if (authContext.orchestratorId !== id) {
      throw forbidden("Orchestrator can only create usage for itself");
    }

    const result = await prisma.$transaction(
      async (tx) => {
        const existing = await tx.orchestratorUsage.findUnique({
          where: {
            orchestratorId_idempotencyKey: {
              orchestratorId: id,
              idempotencyKey,
            },
          },
        });

        if (existing) {
          const requestedCents = convertCreditsToCents(credits);

          if (
            existing.cents !== requestedCents ||
            existing.referenceId !== (referenceId ?? null)
          ) {
            throw conflict(
              "Idempotency key already used with different parameters",
            );
          }

          return { usage: existing, created: false };
        }

        const cents = convertCreditsToCents(credits);
        const consumptions = await prepareConsumptions(
          authContext.userId,
          authContext.organizationId,
          cents,
          tx,
        );

        const transaction = await tx.transaction.create({
          data: {
            amount: cents * BigInt(-1),
            user: { connect: { id: authContext.userId } },
            ...(authContext.organizationId
              ? {
                  organization: { connect: { id: authContext.organizationId } },
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
            cents,
            orchestrator: { connect: { id } },
            user: { connect: { id: authContext.userId } },
            ...(authContext.organizationId
              ? {
                  organization: { connect: { id: authContext.organizationId } },
                }
              : {}),
            transaction: { connect: { id: transaction.id } },
          },
        });

        return { usage, created: true };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );

    const response = serializeUsage(result.usage);

    if (result.created) {
      return created(c, orchestratorUsageSchema.parse(response));
    }

    return ok(c, orchestratorUsageSchema.parse(response));
  });
}
