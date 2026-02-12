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

import { badRequest, conflict } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created, ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { coworkerUsageSchema } from "@/schemas/coworker-usage.schema";

import { requireCoworkerId } from "../helper";
import { createCoworkerUsageRequestSchema } from "./schema";

const route = withGlobalHeaderParameters(
  createRoute({
    method: "post",
    path: "/usage",
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
  }),
);

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
    const { authContext } = c.var;
    const { credits, idempotencyKey, referenceId } = c.req.valid("json");
    const coworkerId = requireCoworkerId(authContext);

    const result = await prisma.$transaction(
      async (tx) => {
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

        const usage = await tx.coworkerUsage.create({
          data: {
            idempotencyKey,
            referenceId: referenceId ?? null,
            cents,
            coworker: { connect: { id: coworkerId } },
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
      return created(c, coworkerUsageSchema.parse(response));
    }

    return ok(c, coworkerUsageSchema.parse(response));
  });
}
