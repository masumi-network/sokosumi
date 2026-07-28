import { createRoute, z } from "@hono/zod-openapi";
import { AgentJobStatus, AgentStatus } from "@sokosumi/database";
import { createAgentClient } from "@sokosumi/masumi";

import { requireJobCollaboration } from "@/helpers/access-control.js";
import { toMasumiAgentForJob } from "@/helpers/agent";
import {
  badRequest,
  conflict,
  notFound,
  unprocessableEntity,
} from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { jobInputSchema } from "@/schemas/job.schema";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "cmi4gmksz000104l8wps8p7fp",
  }),
});

const requestBodySchema = z.object({
  eventId: z.string().openapi({
    example: "event_123",
    description: "The ID of the job event that is awaiting input",
  }),
  inputData: z
    .record(
      z.string(),
      z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.array(z.string()),
        z.array(z.number()),
      ]),
    )
    .openapi({
      example: {
        answer: "8",
        notes: "Pluto is now classified as a dwarf planet",
      },
      description:
        "Input data matching the input schema from the input request",
    }),
});

const route = withGlobalHeaderParameters(
  createRoute({
    method: "post",
    path: "/{id}/inputs",
    description: "Provide input for a job awaiting input",
    tags: ["Jobs"],
    request: {
      params,
      body: {
        content: {
          "application/json": {
            schema: requestBodySchema,
          },
        },
      },
    },
    responses: {
      201: jsonSuccessResponse(jobInputSchema, "Input provided successfully", {
        data: {
          id: "cmi4gmksz000104l8wps8p7fp",
          input: '{"prompt":"How many planets are in the solar system?"}',
          inputHash: "input_hash",
          signature: "signature",
        },
        meta: {
          timestamp: "2025-01-15T12:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      }),
      400: jsonErrorResponse("Bad Request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      409: jsonErrorResponse("Conflict - Input already provided"),
      422: jsonErrorResponse("Unprocessable Entity"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id: jobId } = c.req.valid("param");
    const { eventId, inputData } = c.req.valid("json");

    if (Object.keys(inputData).length === 0) {
      throw badRequest("Input data cannot be empty");
    }

    const jobEvent = await prisma.$transaction(async (tx) => {
      await requireJobCollaboration(c.var.authContext, jobId, tx);
      const jobEvent = await tx.jobEvent.findFirst({
        where: {
          id: eventId,
          jobId,
          status: AgentJobStatus.AWAITING_INPUT,
        },
        include: {
          job: {
            include: {
              agent: {
                select: {
                  id: true,
                  blockchainIdentifier: true,
                  name: true,
                  apiBaseUrl: true,
                  status: true,
                  metadataOverride: {
                    select: {
                      apiBaseUrl: true,
                    },
                  },
                },
              },
            },
          },
          input: true,
        },
      });

      if (!jobEvent) {
        throw notFound("Job event not found or is not awaiting input");
      }

      if (jobEvent.input !== null) {
        throw conflict("Input has already been provided for this event");
      }

      return jobEvent;
    });

    if (!jobEvent.inputSchema) {
      throw unprocessableEntity("Agent did not provide an input schema");
    }

    // Job endpoints are pinned to the agent revision the job started with, so
    // an offline/deregistered agent would otherwise keep receiving user input.
    if (jobEvent.job.agent.status !== AgentStatus.ONLINE) {
      throw unprocessableEntity("Agent is no longer available");
    }

    const provideInputResult = await createAgentClient().provideJobInput(
      toMasumiAgentForJob(jobEvent.job),
      jobEvent.job.agentJobId,
      jobEvent.inputSchema,
      inputData,
    );

    if (provideInputResult.isErr()) {
      throw unprocessableEntity(provideInputResult.error);
    }

    const jobInput = await prisma.jobInput.create({
      data: {
        event: { connect: { id: jobEvent.id } },
        input: JSON.stringify(inputData),
        inputHash: provideInputResult.value.input_hash,
        signature: provideInputResult.value.signature,
      },
    });

    const result = {
      id: jobInput.id,
      input: jobInput.input,
      inputHash: jobInput.inputHash,
      signature: jobInput.signature,
    };

    return created(c, jobInputSchema.parse(result));
  });
}
