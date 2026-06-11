import { createRoute, z } from "@hono/zod-openapi";
import { JobType, jobInclude, NextJobAction } from "@sokosumi/database";
import { mapJobWithStatus } from "@sokosumi/database/helpers";
import { jobPurchaseRepository } from "@sokosumi/database/repositories";

import { paymentClient } from "@/clients/masumi-payment.client.js";
import { requireJobCollaboration } from "@/helpers/access-control.js";
import { notFound, unprocessableEntity } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { jobSchema } from "@/schemas/job.schema.js";
import { serializeJobDetails } from "@/types/job";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "cmi4gmksz000104l8wps8p7fp",
  }),
});

const route = withGlobalHeaderParameters(
  createRoute({
    method: "post",
    path: "/{id}/refund",
    description:
      "Request a refund for a paid job via Masumi. Updates local purchase state so job sync can reconcile.",
    tags: ["Jobs"],
    request: {
      params,
    },
    responses: {
      200: jsonSuccessResponse(jobSchema, "Refund requested", {
        data: {
          id: "cmi4gmksz000104l8wps8p7fp",
          createdAt: "2025-01-15T10:30:00.000Z",
          updatedAt: "2025-01-15T10:35:00.000Z",
          agentId: "agent_123",
          userId: "user_123",
          organizationId: "organization_123",
          taskId: "task_123",
          name: "Research Task",
          jobType: JobType.PAID,
          status: "refund_pending",
          completedAt: null,
          credits: 5,
          onChainStatus: null,
          onChainTransactionHash: null,
          result: null,
          resultHash: null,
          input: null,
          inputHash: null,
          inputSchema: null,
          agentJobId: "agent_job_123",
          identifierFromPurchaser: "identifier_123",
          user: {
            id: "user_123",
            name: "Ada Lovelace",
            image: null,
          },
          organization: {
            id: "organization_123",
            name: "Acme Labs",
            slug: "acme-labs",
          },
          agent: {
            id: "agent_123",
            name: "Research Agent",
            overrideName: null,
            icon: null,
            image: null,
            overrideImage: null,
            legalPrivacyPolicy: null,
            overrideLegalPrivacyPolicy: null,
            legalTerms: null,
            overrideLegalTerms: null,
            legalDpa: null,
            overrideLegalDpa: null,
            legalOther: null,
            overrideLegalOther: null,
          },
          events: [],
          share: null,
        },
        meta: {
          timestamp: "2025-01-15T12:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      }),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      422: jsonErrorResponse("Unprocessable Entity"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id } = c.req.valid("param");

    const { blockchainIdentifier, externalId } = await prisma.$transaction(
      async (tx) => {
        await requireJobCollaboration(c.var.authContext, id, tx);

        const job = await tx.job.findUnique({
          where: { id },
          select: {
            jobType: true,
            blockchainIdentifier: true,
            purchase: { select: { externalId: true } },
          },
        });

        if (!job) {
          throw notFound("Job not found");
        }

        if (job.jobType !== JobType.PAID) {
          throw unprocessableEntity("Only paid jobs can request a refund");
        }

        if (!job.blockchainIdentifier) {
          throw unprocessableEntity(
            "This job does not have an on-chain purchase identifier yet",
          );
        }

        if (!job.purchase?.externalId) {
          throw unprocessableEntity("This job does not have a purchase record");
        }

        return {
          blockchainIdentifier: job.blockchainIdentifier,
          externalId: job.purchase.externalId,
        };
      },
    );

    const refundResult =
      await paymentClient().requestRefund(blockchainIdentifier);
    if (refundResult.isErr()) {
      throw unprocessableEntity(
        "Failed to request refund from payment service",
      );
    }

    const job = await prisma.$transaction(async (tx) => {
      await jobPurchaseRepository.updateJobPurchaseByExternalId(
        externalId,
        {
          nextAction: NextJobAction.SET_REFUND_REQUESTED_REQUESTED,
        },
        tx,
      );

      const updated = await tx.job.findUnique({
        where: { id },
        include: jobInclude,
      });

      if (!updated) {
        throw notFound("Job not found");
      }

      return serializeJobDetails(mapJobWithStatus(updated));
    });

    return ok(c, jobSchema.parse(job));
  });
}
