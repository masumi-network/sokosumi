import { createRoute, z } from "@hono/zod-openapi";

import { requireTaskCommentAccess } from "@/helpers/access-control";
import { forbidden } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  mapTaskParticipantRows,
  taskParticipantRowInclude,
} from "@/helpers/task-participant-rows";
import { subscribeSelfToTask } from "@/helpers/task-participants";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import { taskParticipantSchema } from "@/schemas/task.schema";

const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "tsk_123",
  }),
});

const participantsSchema = z
  .object({
    participants: z.array(taskParticipantSchema),
  })
  .openapi("TaskParticipants");

const route = createRoute({
  method: "post",
  path: "/{id}/participants",
  description:
    "Subscribe the authenticated viewer to the Task: add them as a participant if needed and set `subscribedAt`. Their personal Soko Bot then reports the Task's moments. Idempotent. Does not accept other user ids. Requires comment access. Human session only.",
  tags: ["Tasks"],
  request: {
    params: paramsSchema,
  },
  responses: {
    200: jsonSuccessResponse(participantsSchema, "Task participants"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id } = c.req.valid("param");
    const { userId } = requireOwnerUserContext(c.var.authContext);

    const { task, participants } = await prisma.$transaction(async (tx) => {
      const task = await requireTaskCommentAccess(c.var, id, tx);
      const { subscribed } = await subscribeSelfToTask(tx, {
        taskId: id,
        workspaceId: task.workspaceId,
        visibility: task.visibility,
        ownerId: task.ownerId,
        userId,
      });
      // Comment access ≠ join eligibility (PRIVATE + workspace member).
      if (!subscribed) {
        throw forbidden("You cannot subscribe to this task");
      }
      const participants = await tx.taskParticipant.findMany({
        where: { taskId: id },
        orderBy: { id: "asc" },
        include: taskParticipantRowInclude,
      });
      return { task, participants };
    });

    return ok(
      c,
      participantsSchema.parse({
        participants: mapTaskParticipantRows(
          { id, workspaceId: task.workspaceId },
          participants,
        ),
      }),
    );
  });
}
