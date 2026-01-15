import { createRoute, z } from "@hono/zod-openapi";
import * as Sentry from "@sentry/node";
import { PricingType } from "@sokosumi/database";
import { convertCreditsToCents } from "@sokosumi/database/helpers";
import { jobPurchaseRepository } from "@sokosumi/database/repositories";
import {
  type JobWithCreditTransaction,
  type JobWithEvents,
  type JobWithPurchase,
} from "@sokosumi/database/types/job";
import { createAgentClient } from "@sokosumi/masumi";
import { v4 as uuidv4 } from "uuid";

import { paymentClient } from "@/clients/masumi-payment.client";
import { openrouterClient } from "@/clients/openrouter.client";
import {
  buildAgentAccessWhereClause,
  getAgentAccessContext,
  getAgentCost,
} from "@/helpers/agent";
import { badRequest, notFound, unprocessableEntity } from "@/helpers/error";
import {
  createFreeJob,
  createJobWithPayment,
  validateCreditBalance,
} from "@/helpers/job";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { transformPurchaseToJobUpdate } from "@/helpers/purchase";
import { created } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import {
  createJobRequestSchema,
  flattenInputs,
  jobSchema,
} from "@/schemas/job.schema";
import { agentPricingInclude } from "@/types/agent";
import { flattenJob } from "@/types/job";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "cmaeygqwa000e8i0s9s7wif8i",
  }),
});

const route = withGlobalHeaderParameters(
  createRoute({
    method: "post",
    path: "/{id}/jobs",
    description: "Create a new job for an agent",
    tags: ["Agents"],
    request: {
      params,
      body: {
        content: {
          "application/json": {
            schema: createJobRequestSchema,
          },
        },
      },
    },
    responses: {
      201: jsonSuccessResponse(jobSchema, "Job created successfully"),
      400: jsonErrorResponse("Bad Request"),
      404: jsonErrorResponse("Agent not found"),
      422: jsonErrorResponse("Unprocessable Entity"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const { id: agentId } = c.req.valid("param");
    const { maxCredits, inputData, inputSchema, name } = c.req.valid("json");

    const flatInputSchema = flattenInputs(inputSchema);
    const maxCents = maxCredits ? convertCreditsToCents(maxCredits) : null;

    // Validate agent and get pricing in transaction
    const agent = await prisma.$transaction(async (tx) => {
      const { userOrganizationIds, creditCosts } = await getAgentAccessContext(
        authContext,
        tx,
      );

      const agent = await tx.agent.findFirst({
        where: {
          id: agentId,
          ...buildAgentAccessWhereClause(
            userOrganizationIds,
            authContext.organizationId,
            creditCosts,
          ),
        },
        include: {
          ...agentPricingInclude,
        },
      });

      if (!agent) {
        throw notFound("Agent not found");
      }

      const cost = getAgentCost(agent, creditCosts);

      if (maxCents !== null && cost.cents > maxCents) {
        throw badRequest("Credit cost exceeds maximum accepted credits");
      }

      await validateCreditBalance(
        authContext.userId,
        authContext.organizationId,
        cost.cents,
        tx,
      );

      return { ...agent, cost };
    });

    // Generate job name if not provided
    let jobName = name?.trim() || null;
    if (!jobName) {
      const generatedName = await openrouterClient.generateJobName(
        {
          name: agent.name,
          description: agent.description,
        },
        inputData,
      );
      jobName = generatedName;
    }

    // Start job with agent
    let job: JobWithEvents & JobWithCreditTransaction & JobWithPurchase;
    switch (agent.pricing.pricingType) {
      case PricingType.FREE:
        const freeJobResult = await createAgentClient().startFreeAgentJob(
          agent,
          inputData,
        );

        if (freeJobResult.isErr()) {
          throw unprocessableEntity(
            `Free agent job start failed: ${freeJobResult.error}`,
          );
        }

        job = await createFreeJob(
          {
            agentId,
            userId: authContext.userId,
            organizationId: authContext.organizationId,
            inputData,
            inputSchema: flatInputSchema,
            name: jobName,
          },
          freeJobResult.value,
        );
        break;
      case PricingType.FIXED:
        const identifierFromPurchaser = uuidv4()
          .replace(/-/g, "")
          .substring(0, 20);

        const paidJobResult = await createAgentClient().startPaidAgentJob(
          {
            id: agent.id,
            name: agent.name,
            blockchainIdentifier: agent.blockchainIdentifier,
            apiBaseUrl: agent.apiBaseUrl,
            overrideApiBaseUrl: agent.overrideApiBaseUrl,
          },
          identifierFromPurchaser,
          inputData,
        );

        if (paidJobResult.isErr()) {
          throw unprocessableEntity(
            `Paid agent job start failed: ${paidJobResult.error}`,
          );
        }

        job = await createJobWithPayment(
          {
            agentId,
            userId: authContext.userId,
            organizationId: authContext.organizationId,
            inputData,
            inputSchema: flatInputSchema,
            name: jobName,
          },
          agent.cost,
          paidJobResult.value,
          identifierFromPurchaser,
        );

        // Create purchase with payment API
        const createPurchaseResult = await paymentClient().createPurchase(
          agent.blockchainIdentifier,
          paidJobResult.value,
          inputData,
          identifierFromPurchaser,
        );

        createPurchaseResult.match(
          (purchase) => {
            const purchaseData = transformPurchaseToJobUpdate(purchase);
            jobPurchaseRepository
              .createJobPurchase(
                {
                  jobId: job.id,
                  ...purchaseData,
                },
                prisma,
              )
              .catch((error) => {
                Sentry.captureException(error);
              });
          },
          (error) => {
            Sentry.captureException(error);
          },
        );
        break;
      case PricingType.UNKNOWN:
      default:
        throw unprocessableEntity("Agent pricing type not supported");
    }
    return created(c, jobSchema.parse(flattenJob(job)));
  });
}
