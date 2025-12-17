import { createRoute, z } from "@hono/zod-openapi";
import { AgentJobStatus } from "@sokosumi/database";
import prisma from "@sokosumi/database/client";

import { requireJobAccess } from "@/helpers/access-control.js";
import { notFound, unprocessableEntity } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "cmi4gmksz000104l8wps8p7fp",
  }),
});

const inputRequestSchema = z.object({
  eventId: z.string().openapi({ example: "event_123" }),
  message: z
    .string()
    .nullish()
    .openapi({ example: "How many planets are in the solar system?" }),
  inputSchema: z.string().openapi({ example: "input_schema" }),
});

const route = createRoute({
  method: "get",
  path: "/{id}/input-request",
  tags: ["Jobs"],
  request: {
    params,
  },
  responses: {
    200: jsonSuccessResponse(
      inputRequestSchema,
      "Retrieve input request by ID",
      {
        data: {
          id: "input_request_123",
          message: "How many planets are in the solar system?",
          inputSchema: "input_schema",
        },
        meta: {
          timestamp: "2025-01-15T12:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const { id } = c.req.valid("param");

    const jobStatus = await prisma.$transaction(async (tx) => {
      await requireJobAccess(authContext, id, tx);
      const jobStatus = await tx.jobStatus.findFirst({
        where: {
          jobId: id,
          status: AgentJobStatus.AWAITING_INPUT,
          input: { is: null },
        },
        orderBy: {
          createdAt: "asc",
        },
        take: 1,
      });
      if (!jobStatus) {
        throw notFound("No input request found");
      }

      if (!jobStatus.inputSchema) {
        throw unprocessableEntity("Agent did not provide an input schema");
      }
      return jobStatus;
    });

    const inputRequest = {
      eventId: jobStatus.id,
      message: jobStatus.result,
      inputSchema: jobStatus.inputSchema,
    };

    return ok(c, inputRequestSchema.parse(inputRequest));
  });
}
