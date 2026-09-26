import { createRoute } from "@hono/zod-openapi";

import { buildCoworkerUsableInWorkspaceWhere } from "@/helpers/access-control";
import { coworkerInclude, mapCoworker } from "@/helpers/coworker";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { taskScheduleAssigneesSchema } from "@/schemas/task-schedule.schema";

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "get",
    path: "/schedules/assignees",
    operationId: "getTaskScheduleAssignees",
    description:
      "List coworkers and the owner's Soko Bot eligible for Task Schedule assignment in the active workspace",
    tags: ["Task Schedules"],
    responses: {
      200: jsonSuccessResponse(
        taskScheduleAssigneesSchema,
        "Eligible Task Schedule assignees",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const auth = requireUserAuthContext(c.var.authContext);
    const workspace = requireWorkspaceContext(c.var.workspaceContext);
    const [coworkers, sokoBot] = await Promise.all([
      prisma.coworker.findMany({
        where: {
          ...buildCoworkerUsableInWorkspaceWhere(workspace.workspaceId),
          capabilities: { has: "tasks" },
        },
        orderBy: [{ priority: "desc" }, { slug: "asc" }],
        include: coworkerInclude,
      }),
      prisma.sokoBot.findFirst({
        where: {
          userId: auth.userId,
          workspaceId: workspace.workspaceId,
          archivedAt: null,
          deletedAt: null,
        },
        select: {
          id: true,
          name: true,
          avatarSeed: true,
          avatarImageUrl: true,
        },
      }),
    ]);
    return ok(
      c,
      taskScheduleAssigneesSchema.parse({
        coworkers: coworkers.map(mapCoworker),
        sokoBot,
      }),
    );
  });
}
