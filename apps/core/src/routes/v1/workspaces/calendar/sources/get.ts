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

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/calendar/sources",
    description:
      "List the active workspace and Project Calendar sources available to the caller",
    tags: ["Workspaces"],
    responses: {
      200: jsonSuccessResponse(
        z.array(workspaceCalendarSourceSchema),
        "Active workspace Calendar sources",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    await requireAuthorizedUserContext(c.var.authContext);
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const workspaceId = workspaceContext.workspaceId;

    const [workspace, projects, legacyOccurrence] = await Promise.all([
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
        select: { id: true, name: true, logo: true, closedAt: true },
      }),
      prisma.taskScheduleOccurrence.findFirst({
        where: {
          sourceWorkspaceId: workspaceId,
          sourceType: CalendarSourceType.LEGACY_UNKNOWN,
        },
        select: { id: true },
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
        }),
      ),
    ];

    if (legacyOccurrence) {
      sources.push(
        workspaceCalendarSourceSchema.parse({
          sourceId: getCalendarSourceId({
            sourceWorkspaceId: workspaceId,
            sourceType: CalendarSourceType.LEGACY_UNKNOWN,
            sourceProjectId: null,
          }),
          sourceType: CalendarSourceType.LEGACY_UNKNOWN,
          displayName: "Legacy source",
          logoUrl: null,
          paletteToken: "amber",
        }),
      );
    }

    return ok(c, sources);
  });
}
