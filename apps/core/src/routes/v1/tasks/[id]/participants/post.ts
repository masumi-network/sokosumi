import { randomUUID } from "node:crypto";
import { createRoute, z } from "@hono/zod-openapi";
import { waitUntil } from "@vercel/functions";

import { requireTaskCommentAccess } from "@/helpers/access-control";
import { userSummaryFromLoadedRelation } from "@/helpers/loaded-relation-summaries";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { notifyTaskParticipantsAdded } from "@/helpers/task-notifications";
import { addSelfAsTaskParticipant } from "@/helpers/task-participants";
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
    "Subscribe the authenticated viewer as a Task participant. Idempotent. Does not accept other user ids. Requires comment access. Human session only.",
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

    const { participants, addedUserIds } = await prisma.$transaction(
      async (tx) => {
        const task = await requireTaskCommentAccess(c.var, id, tx);
        const { added } = await addSelfAsTaskParticipant(tx, {
          taskId: id,
          workspaceId: task.workspaceId,
          visibility: task.visibility,
          ownerId: task.ownerId,
          userId,
        });
        const rows = await tx.taskParticipant.findMany({
          where: { taskId: id },
          orderBy: { id: "asc" },
          include: {
            user: { select: { id: true, name: true, image: true } },
          },
        });
        return {
          participants: rows,
          addedUserIds: added ? [userId] : [],
        };
      },
    );

    if (addedUserIds.length > 0) {
      // Synthetic event id: createNotification needs one; no TaskEvent row.
      const eventId = randomUUID();
      waitUntil(notifyTaskParticipantsAdded(id, eventId, addedUserIds));
    }

    return ok(
      c,
      participantsSchema.parse({
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
