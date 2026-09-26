import { createRoute, z } from "@hono/zod-openapi";

import { requireTaskReadForRouteVars } from "@/helpers/access-control";
import { forbidden } from "@/helpers/error";
import { userSummaryFromLoadedRelation } from "@/helpers/loaded-relation-summaries";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { markTaskParticipantRemovedRead } from "@/helpers/task-notifications";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import { taskParticipantSchema } from "@/schemas/task.schema";

const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "tsk_123",
  }),
  userId: z.string().openapi({
    param: { name: "userId", in: "path" },
    example: "user_123",
  }),
});

const removedSchema = z
  .object({
    participants: z.array(taskParticipantSchema),
  })
  .openapi("TaskParticipants");

const route = createRoute({
  method: "delete",
  path: "/{id}/participants/{userId}",
  description:
    "Leave a Task as a participant (self only). `userId` must be the authenticated viewer. Missing participants are a no-op. Does not change owner or assignee. Human session only.",
  tags: ["Tasks"],
  request: {
    params: paramsSchema,
  },
  responses: {
    200: jsonSuccessResponse(removedSchema, "Task participants"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id, userId } = c.req.valid("param");
    const actor = requireOwnerUserContext(c.var.authContext);

    if (userId !== actor.userId) {
      throw forbidden("Only a participant may remove themselves");
    }

    const participants = await prisma.$transaction(async (tx) => {
      await requireTaskReadForRouteVars(c.var, id, tx);

      await tx.taskParticipant.deleteMany({
        where: { taskId: id, userId },
      });
      return tx.taskParticipant.findMany({
        where: { taskId: id },
        orderBy: { id: "asc" },
        include: {
          user: { select: { id: true, name: true, image: true } },
        },
      });
    });

    await markTaskParticipantRemovedRead(userId, id);

    return ok(
      c,
      removedSchema.parse({
        participants: participants.map((row) => ({
          user: userSummaryFromLoadedRelation(
            `Task ${id} participant`,
            row.userId,
            row.user,
          ),
          addedAt: row.createdAt,
        })),
      }),
    );
  });
}
