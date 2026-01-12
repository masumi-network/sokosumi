import { createRoute, z } from "@hono/zod-openapi";
import { PricingType } from "@sokosumi/database";
import prisma from "@sokosumi/database/client";
import { convertCreditsToCents } from "@sokosumi/database/helpers";
import {
  jobWithCreditTransaction,
  jobWithEvents,
  jobWithPurchase,
} from "@sokosumi/database/types/job";
import { createAgentClient } from "@sokosumi/masumi";
import { v4 as uuidv4 } from "uuid";

import { notFound, unprocessableEntity } from "@/helpers/error";
import {
  createFreeJob,
  createJobWithPayment,
  shareJob,
  updateJobName,
  validateAgentAndPricing,
  validateCreditBalance,
} from "@/helpers/job";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import {
  createJobRequestSchema,
  flattenInputs,
  jobSchema,
} from "@/schemas/job.schema";
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
      401: jsonErrorResponse("Unauthorized"),
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
    const { maxAcceptedCredits, inputData, inputSchema, name, share } =
      c.req.valid("json");

    const flatInputSchema = flattenInputs(inputSchema);
    // Convert credits to cents
    const maxAcceptedCents = convertCreditsToCents(maxAcceptedCredits);

    // Fetch agent input schema
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      select: {
        id: true,
        name: true,
        blockchainIdentifier: true,
        apiBaseUrl: true,
        overrideApiBaseUrl: true,
      },
    });

    if (!agent) {
      throw notFound("Agent not found");
    }

    // Validate agent and get pricing in transaction
    const agentWithPrice = await prisma.$transaction(async (tx) => {
      const validatedAgent = await validateAgentAndPricing(
        agentId,
        authContext,
        maxAcceptedCents,
        tx,
      );

      // Validate credit balance if paid job
      if (
        validatedAgent.pricing.pricingType === PricingType.FIXED &&
        validatedAgent.creditsPrice.cents > 0
      ) {
        await validateCreditBalance(
          authContext.userId,
          authContext.organizationId,
          validatedAgent.creditsPrice.cents,
          tx,
        );
      }

      return validatedAgent;
    });

    // Start job with agent
    let jobId: string;
    if (agentWithPrice.pricing.pricingType === PricingType.FREE) {
      // Free job
      const startJobResult = await createAgentClient().startFreeAgentJob(
        {
          id: agent.id,
          name: agent.name,
          blockchainIdentifier: agent.blockchainIdentifier,
          apiBaseUrl: agent.apiBaseUrl,
          overrideApiBaseUrl: agent.overrideApiBaseUrl,
        },
        inputData,
      );

      if (!startJobResult.ok) {
        throw unprocessableEntity(
          `Free agent job start failed: ${startJobResult.error}`,
        );
      }

      jobId = await createFreeJob(
        {
          agentId,
          userId: authContext.userId,
          organizationId: authContext.organizationId,
          inputData,
          inputSchema: flatInputSchema,
          name: name?.trim() || null,
        },
        startJobResult.data.id,
      );
    } else {
      // Paid job
      const identifierFromPurchaser = uuidv4()
        .replace(/-/g, "")
        .substring(0, 20);

      const startJobResult = await createAgentClient().startPaidAgentJob(
        {
          id: agentWithPrice.id,
          name: agentWithPrice.name,
          blockchainIdentifier: agentWithPrice.blockchainIdentifier,
          apiBaseUrl: agentWithPrice.apiBaseUrl,
          overrideApiBaseUrl: agentWithPrice.overrideApiBaseUrl,
        },
        identifierFromPurchaser,
        inputData,
      );

      if (!startJobResult.ok) {
        throw unprocessableEntity(
          `Paid agent job start failed: ${startJobResult.error}`,
        );
      }

      jobId = await createJobWithPayment(
        {
          agentId,
          userId: authContext.userId,
          organizationId: authContext.organizationId,
          inputData,
          inputSchema: flatInputSchema,
          name: name?.trim() || null,
        },
        agentWithPrice,
        startJobResult.data,
      );
    }

    // Update job name if provided and different from generated
    if (name && name.trim()) {
      await updateJobName(jobId, name.trim());
    }

    // Share job if requested
    if (share) {
      await prisma.$transaction(async (tx) => {
        await shareJob(jobId, authContext, tx);
      });
    }

    // Fetch complete job with all relations
    const createdJob = await prisma.job.findUnique({
      where: { id: jobId },
      include: {
        ...jobWithEvents,
        ...jobWithCreditTransaction,
        ...jobWithPurchase,
      },
    });

    if (!createdJob) {
      throw notFound("Job not found after creation");
    }

    const flattenedJob = flattenJob(createdJob);
    return created(c, jobSchema.parse(flattenedJob));
  });
}
