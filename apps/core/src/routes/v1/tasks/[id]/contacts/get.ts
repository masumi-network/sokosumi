import { createRoute, z } from "@hono/zod-openapi";
import { requireTaskReadForRouteVars } from "@/helpers/access-control";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { contactActor } from "@/routes/v1/contacts/context";
import { taskContactSchema } from "@/schemas/task.schema";

const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "tsk_123",
  }),
});

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/{id}/contacts",
    description:
      "List the contacts tagged on this Task. Empty unless the Task is in the active workspace and the reader may see its contacts.",
    tags: ["Tasks"],
    request: { params: paramsSchema },
    responses: {
      200: jsonSuccessResponse(z.array(taskContactSchema), "Tagged contacts"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id } = c.req.valid("param");
    const task = await requireTaskReadForRouteVars(c.var, id, prisma);
    // Contacts are workspace data: a Task reader outside it sees none.
    const { workspaceId } = await contactActor(c);
    if (task.workspaceId !== workspaceId) return ok(c, []);

    const tags = await prisma.taskContact.findMany({
      where: { taskId: task.id, contact: { workspaceId, archivedAt: null } },
      // Tags made together share a time; name keeps their order stable.
      orderBy: [{ createdAt: "asc" }, { contact: { name: "asc" } }],
      select: { contact: { select: { id: true, name: true } } },
    });
    return ok(
      c,
      tags.map((tag) => tag.contact),
    );
  });
}
