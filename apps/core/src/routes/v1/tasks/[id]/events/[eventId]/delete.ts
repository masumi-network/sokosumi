import { createRoute, z } from "@hono/zod-openapi";

import { requireTaskOwnership } from "@/helpers/access-control";
import { badRequest, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";

const deletedSchema = z
  .object({
    deleted: z.literal(true),
  })
  .openapi("TaskEventDeleted");

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

const route = createRoute({
  method: "delete",
  path: "/{id}/events/{eventId}",
  description:
    "Discard a held comment without approving the writing coworker's access. Only held comments can be deleted. Task owner only.",
  tags: ["Tasks"],
  request: {
    params: paramsSchema,
  },
  responses: {
    200: jsonSuccessResponse(deletedSchema, "Held comment discarded"),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    // Session-only on purpose: a delegated coworker must never discard the
    // audit trail of its own held comment.
    const authContext = requireUserAuthContext(c.var.authContext);
    const { id, eventId } = c.req.valid("param");

    await prisma.$transaction(async (tx) => {
      await requireTaskOwnership({ source: "session", ...authContext }, id, tx);

      const event = await tx.taskEvent.findFirst({
        where: { id: eventId, taskId: id },
        select: { heldByGrantId: true },
      });
      if (!event) {
        throw notFound("Task event not found");
      }
      if (!event.heldByGrantId) {
        throw badRequest("Only held comments can be deleted");
      }

      // Conditional delete: a concurrent grant approval may release the
      // comment between the check above and this write — a comment that has
      // become public must never be deleted here.
      const deleted = await tx.taskEvent.deleteMany({
        where: { id: eventId, heldByGrantId: { not: null } },
      });
      if (deleted.count === 0) {
        throw badRequest("Only held comments can be deleted");
      }
    });

    return ok(c, deletedSchema.parse({ deleted: true }));
  });
}
