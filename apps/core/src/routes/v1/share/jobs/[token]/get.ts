import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { type JobWithSokosumiStatus } from "@sokosumi/database";
import {
  jobRepository,
  jobShareRepository,
} from "@sokosumi/database/repositories";

import { notFound } from "@/helpers/error.js";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  jobShareSchema,
  publicSharedJobResponseSchema,
} from "@/schemas/job-share.schema.js";

const paramsSchema = z.object({
  token: z.string().openapi({
    param: { name: "token", in: "path" },
    example: "public-share-token",
  }),
});

const route = createRoute({
  method: "get",
  path: "/{token}",
  description: "Get a publicly shared job by share token",
  tags: ["Share"],
  security: [],
  request: {
    params: paramsSchema,
  },
  responses: {
    200: jsonSuccessResponse(
      publicSharedJobResponseSchema,
      "Retrieve a publicly shared job",
    ),
    404: jsonErrorResponse("Not Found"),
  },
});

function serializePublicSharedJob(job: JobWithSokosumiStatus) {
  return {
    id: job.id,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
    taskId: job.taskId,
    name: job.name,
    jobType: job.jobType,
    status: job.status,
    credits: job.credits,
    agentJobId: job.agentJobId,
    identifierFromPurchaser: job.identifierFromPurchaser,
    user: {
      id: job.user.id,
      name: job.user.name,
      image: job.user.image,
    },
    agent: {
      id: job.agent.id,
      name: job.agent.name,
      overrideName: job.agent.overrideName,
      icon: job.agent.icon,
      image: job.agent.image,
      overrideImage: job.agent.overrideImage,
      legalPrivacyPolicy: job.agent.legalPrivacyPolicy,
      overrideLegalPrivacyPolicy: job.agent.overrideLegalPrivacyPolicy,
      legalTerms: job.agent.legalTerms,
      overrideLegalTerms: job.agent.overrideLegalTerms,
      legalDpa: job.agent.legalDpa,
      overrideLegalDpa: job.agent.overrideLegalDpa,
      legalOther: job.agent.legalOther,
      overrideLegalOther: job.agent.overrideLegalOther,
    },
    transaction: job.transaction
      ? {
          amount: job.transaction.amount.toString(),
        }
      : null,
    purchase: job.purchase
      ? {
          onChainStatus: job.purchase.onChainStatus,
          onChainTransactionHash: job.purchase.onChainTransactionHash,
          resultHash: job.purchase.resultHash,
        }
      : null,
    events: job.events.map((event) => ({
      id: event.id,
      createdAt: event.createdAt,
      updatedAt: event.updatedAt,
      status: event.status,
      inputSchema: event.inputSchema,
      input: event.input
        ? {
            id: event.input.id,
            input: event.input.input,
            inputHash: event.input.inputHash,
            signature: event.input.signature,
          }
        : null,
      result: event.result,
      blobs: event.blobs.map((blob) => ({
        ...blob,
        size: blob.size === null ? null : Number(blob.size),
      })),
      links: event.links,
    })),
  };
}

export default function mount(app: OpenAPIHono) {
  app.openapi(route, async (c) => {
    const { token } = c.req.valid("param");

    const result = await prisma.$transaction(async (tx) => {
      const share = await jobShareRepository.getShareByToken(token, tx);
      if (!share) {
        throw notFound("Job share not found");
      }

      const job = await jobRepository.getJobById(share.jobId, tx);
      if (!job) {
        throw notFound("Job not found");
      }

      return {
        job: serializePublicSharedJob(job),
        share: jobShareSchema.parse(share),
      };
    });

    return ok(c, publicSharedJobResponseSchema.parse(result));
  });
}
