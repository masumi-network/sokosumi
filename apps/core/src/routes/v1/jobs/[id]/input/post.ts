import { createRoute, z } from "@hono/zod-openapi";
import { AgentJobStatus } from "@sokosumi/database";
import prisma from "@sokosumi/database/client";
import { createAgentClient } from "@sokosumi/masumi";

import { requireJobAccess } from "@/helpers/access-control.js";
import {
  badRequest,
  conflict,
  notFound,
  unprocessableEntity,
} from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
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

const route = createRoute({
  method: "post",
  path: "/{id}/input",
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
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const { id: jobId } = c.req.valid("param");
    const { eventId, inputData } = c.req.valid("json");

    if (Object.keys(inputData).length === 0) {
      throw badRequest("Input data cannot be empty");
    }

    const jobStatus = await prisma.$transaction(async (tx) => {
      await requireJobAccess(authContext, jobId, tx);
      const jobStatus = await tx.jobStatus.findFirst({
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
                  overrideApiBaseUrl: true,
                },
              },
            },
          },
          input: true,
        },
      });

      if (!jobStatus) {
        throw notFound("Job status not found or is not awaiting input");
      }

      if (jobStatus.input !== null) {
        throw conflict("Input has already been provided for this status");
      }

      if (!jobStatus.inputSchema) {
        throw unprocessableEntity("Agent did not provide an input schema");
      }

      return jobStatus;
    });

    if (!jobStatus.externalId) {
      throw unprocessableEntity(
        "Agent did not provide an external ID for the status",
      );
    }

    const provideInputResult = await createAgentClient().provideJobInput(
      jobStatus.job.agent,
      jobStatus.externalId,
      jobStatus.job.agentJobId,
      inputData,
    );

    if (!provideInputResult.ok) {
      throw unprocessableEntity(provideInputResult.error);
    }

    const jobInput = await prisma.jobInput.create({
      data: {
        status: { connect: { id: jobStatus.id } },
        input: JSON.stringify(inputData),
        inputHash: provideInputResult.data.input_hash,
        signature: provideInputResult.data.signature,
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
