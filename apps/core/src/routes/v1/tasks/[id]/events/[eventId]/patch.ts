import { createRoute, z } from "@hono/zod-openapi";

import { requireTaskOwnership } from "@/helpers/access-control";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { mapTaskEvent, taskEventApiInclude } from "@/helpers/task";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { taskEventSchema } from "@/schemas/task.schema";

const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "tsk_123",
  }),
  eventId: z.string().openapi({
    param: { name: "eventId", in: "path" },
    example: "te_123",
  }),
});

const releaseHeldTaskEventRequestSchema = z
  .object({
    held: z.literal(false).openapi({
      description:
        "Set to false to release the held comment. Releasing is the only supported mutation.",
      example: false,
    }),
  })
  .openapi("ReleaseHeldTaskEventRequest");

const route = createRoute({
  method: "patch",
  path: "/{id}/events/{eventId}",
  description:
    "Release a single held comment so everyone on the task can see it. The writing coworker's access request stays pending, so its next comment is held again. Task owner only. Idempotent.",
  tags: ["Tasks"],
  request: {
    params: paramsSchema,
    body: {
      content: {
        "application/json": { schema: releaseHeldTaskEventRequestSchema },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(taskEventSchema, "Held comment released"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    // Session-only on purpose: a delegated coworker must never release its
    // own held comment.
    const authContext = requireUserAuthContext(c.var.authContext);
    const { id, eventId } = c.req.valid("param");
    c.req.valid("json");

    const released = await prisma.$transaction(async (tx) => {
      await requireTaskOwnership({ source: "session", ...authContext }, id, tx);

      // Conditional update instead of check-then-update: a concurrent grant
      // approval may release this event between a check and the write (P2025
      // otherwise). Matching nothing is fine — releasing is idempotent.
      await tx.taskEvent.updateMany({
        where: { id: eventId, taskId: id, heldByGrantId: { not: null } },
        data: { heldByGrantId: null },
      });

      const event = await tx.taskEvent.findFirst({
        where: { id: eventId, taskId: id },
        include: taskEventApiInclude,
      });
      if (!event) {
        throw notFound("Task event not found");
      }

      return event;
    });

    return ok(c, taskEventSchema.parse(mapTaskEvent(released)));
  });
}
