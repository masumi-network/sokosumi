import { createRoute, z } from "@hono/zod-openapi";

import { requireTaskReadForRouteVars } from "@/helpers/access-control";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  mapTaskParticipantRows,
  taskParticipantRowInclude,
} from "@/helpers/task-participant-rows";
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
  method: "delete",
  path: "/{id}/subscription",
  description:
    "Unsubscribe the authenticated viewer from the Task. Clears `subscribedAt`; the viewer stays a participant. Leave the Task to remove the participant row. Not subscribed is a no-op. Human session only.",
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
      const task = await requireTaskReadForRouteVars(c.var, id, tx);
      await tx.taskParticipant.updateMany({
        where: { taskId: id, userId },
        data: { subscribedAt: null },
      });
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
