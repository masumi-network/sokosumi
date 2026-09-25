import { createRoute, z } from "@hono/zod-openapi";
import { CalendarSourceType } from "@sokosumi/database";
import { getCalendarSourceId } from "@/helpers/calendar-source";
import { requireAuthorizedUserContext } from "@/helpers/coworker-user-context-binding";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { workspaceCalendarSourceSchema } from "@/schemas/workspace-calendar.schema";
import { canCreateTaskSchedules } from "@/services/task-schedule.service";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/calendar/sources",
    description:
      "List workspace and Project Calendar sources, including sources only available for event display and filtering",
    tags: ["Workspaces"],
    responses: {
      200: jsonSuccessResponse(
        z.array(workspaceCalendarSourceSchema),
        "Workspace Calendar sources with scheduling availability",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    // Still an authorization check, even though nothing reads the context.
    await requireAuthorizedUserContext(c.var.authContext);
    const workspaceId = workspaceContext.workspaceId;
    const isSchedulable = await canCreateTaskSchedules(c.var);

    const [workspace, projects] = await Promise.all([
      prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: {
          organization: { select: { name: true, logo: true } },
          user: { select: { name: true, image: true } },
        },
      }),
      prisma.project.findMany({
        where: { workspaceId },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        select: {
          id: true,
          name: true,
          logo: true,
          closingAt: true,
          closedAt: true,
        },
      }),
    ]);
    if (!workspace) {
      throw notFound("Workspace not found");
    }

    const workspaceOwner = workspace.organization ?? workspace.user;
    const sources = [
      workspaceCalendarSourceSchema.parse({
        sourceId: getCalendarSourceId({
          sourceWorkspaceId: workspaceId,
          sourceType: CalendarSourceType.WORKSPACE,
          sourceProjectId: null,
        }),
        sourceType: CalendarSourceType.WORKSPACE,
        displayName: workspaceOwner?.name ?? "Workspace",
        logoUrl: workspace.organization?.logo || workspace.user?.image || null,
        paletteToken: "blue",
        isSchedulable,
      }),
      ...projects.map((project) =>
        workspaceCalendarSourceSchema.parse({
          sourceId: getCalendarSourceId({
            sourceWorkspaceId: workspaceId,
            sourceType: CalendarSourceType.PROJECT,
            sourceProjectId: project.id,
          }),
          sourceType: CalendarSourceType.PROJECT,
          displayName: project.name,
          logoUrl: project.logo || null,
          paletteToken: "violet",
          isSchedulable:
            isSchedulable &&
            project.closingAt === null &&
            project.closedAt === null,
        }),
      ),
    ];

    return ok(c, sources);
  });
}
