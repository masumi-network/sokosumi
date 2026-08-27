import { createRoute } from "@hono/zod-openapi";
import { Prisma } from "@sokosumi/database";
import {
  type Consumption,
  creditBucketRepository,
} from "@sokosumi/database/repositories";
import { convertCentsToCredits, convertCreditsToCents } from "@sokosumi/utils";

import { badRequest, conflict, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { findOrchestratorForUser } from "@/helpers/orchestrator-instance";
import { requireOrganizationWorkstation } from "@/helpers/organization-workstation";
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
    "Create usage for the orchestrator instance of the user in the body. Bills the organization credit pool when X-Context organization is present; otherwise personal credits.",
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
    credits: convertCentsToCredits(usage.cents),
    transactionId: usage.transactionId,
  });
}

async function prepareOrchestratorConsumptions(
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
    const orchestratorContext = requireOrchestratorAuthContext(
      c.var.authContext,
    );
    const { credits, idempotencyKey, referenceId, userId } =
      c.req.valid("json");
    const organizationId = orchestratorContext.context?.organizationId ?? null;

    const result = await serializableTransaction(async (tx) => {
      // Include archived rows so idempotent retries still resolve after purge
      // (one orchestrator row per userId; archive does not change the id).
      const orchestrator = await findOrchestratorForUser(userId, tx);
      if (!orchestrator) {
        throw notFound("Orchestrator instance not found for user");
      }
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

        return { usage: existing, created: false };
      }

      // New charges require a live instance.
      if (orchestrator.archivedAt != null) {
        throw notFound("Orchestrator instance not found for user");
      }

      await requireOrganizationWorkstation(userId, organizationId, tx);

      const cents = convertCreditsToCents(credits);
      const consumptions = await prepareOrchestratorConsumptions(
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
            ? { organization: { connect: { id: organizationId } } }
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
