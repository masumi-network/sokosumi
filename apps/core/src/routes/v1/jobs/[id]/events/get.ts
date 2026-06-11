import { createRoute, z } from "@hono/zod-openapi";
import { jobWithEvents } from "@sokosumi/database/types/job";

import { requireJobReadForRouteVars } from "@/helpers/access-control.js";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { jobEventsSchema } from "@/schemas/job.schema.js";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "cmi4gmksz000104l8wps8p7fp",
  }),
});

const route = withGlobalHeaderParameters(
  createRoute({
    method: "get",
    path: "/{id}/events",
    description: "Get events for a job",
    tags: ["Jobs"],
    request: {
      params,
    },
    responses: {
      200: jsonSuccessResponse(jobEventsSchema, "Retrieve events for a job", {
        data: [
          {
            id: "event_123",
            createdAt: "2025-01-15T10:30:00.000Z",
            updatedAt: "2025-01-15T10:30:00.000Z",
            status: "INITIATED",
            inputSchema: "input_schema",
            input: {
              id: "input_123",
              input: '{"prompt":"How many planets are in the solar system?"}',
              inputHash: "input_hash",
              signature: null,
            },
            result: null,
            blobs: [],
            links: [],
          },
          {
            id: "event_456",
            createdAt: "2025-01-15T10:35:00.000Z",
            updatedAt: "2025-01-15T10:35:00.000Z",
            status: "COMPLETED",
            inputSchema: null,
            input: null,
            result: "# Answer\n\nThere are 8 planets in the solar system.",
            blobs: [],
            links: [],
          },
        ],
        meta: {
          timestamp: "2025-01-15T12:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      }),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const { id } = c.req.valid("param");

    const events = await prisma.$transaction(async (tx) => {
      await requireJobReadForRouteVars(c.var, id, tx);
      const job = await tx.job.findFirst({
        where: {
          id,
          workspaceId: workspaceContext.workspaceId,
        },
        include: {
          ...jobWithEvents,
        },
      });
      if (!job) {
        throw notFound("Job not found");
      }

      const events = job.events.map((event) => ({
        ...event,
        files: event.blobs.map((blob) => ({
          ...blob,
          jobId: id,
          size: blob.size ? Number(blob.size) : null,
        })),
        links: event.links.map((link) => ({
          ...link,
          jobId: id,
        })),
      }));
      return events;
    });

    return ok(c, jobEventsSchema.parse(events));
  });
}
