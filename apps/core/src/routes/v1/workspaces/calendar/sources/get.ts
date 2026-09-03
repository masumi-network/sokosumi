import { createRoute, z } from "@hono/zod-openapi";
import { CalendarSourceType } from "@sokosumi/database";
import { isNmkrEmail } from "@sokosumi/utils";
import { HTTPException } from "hono/http-exception";

import { getCalendarSourceId } from "@/helpers/calendar-source";
import { requireAuthorizedUserContext } from "@/helpers/coworker-user-context-binding";
import { forbidden, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { requireAssignedOrganizationSeat } from "@/helpers/organization-assigned-seat";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { type AuthenticationContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { workspaceCalendarSourceSchema } from "@/schemas/workspace-calendar.schema";
import { requireScheduledTaskCreator } from "@/services/task-schedule-create.service";

async function isScheduledTaskCreationAllowed(
  authContext: AuthenticationContext,
  workspaceId: string,
  organizationId: string | null,
): Promise<boolean> {
  try {
    const creator = await requireScheduledTaskCreator(authContext, workspaceId);
    await requireAssignedOrganizationSeat(
      creator.userContext.userId,
      organizationId,
    );
    return true;
  } catch (error) {
    if (error instanceof HTTPException && error.status === 403) {
      return false;
    }
    throw error;
  }
}

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
    const userContext = await requireAuthorizedUserContext(c.var.authContext);
    const user = await prisma.user.findUnique({
      where: { id: userContext.userId },
      select: { email: true },
    });
    if (!isNmkrEmail(user?.email)) {
      throw forbidden("Calendar is only available to NMKR users");
    }
    const workspaceId = workspaceContext.workspaceId;
    const isSchedulable = await isScheduledTaskCreationAllowed(
      c.var.authContext,
      workspaceId,
      workspaceContext.organizationId,
    );

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
        select: {
          id: true,
          name: true,
          logo: true,
          closingAt: true,
          closedAt: true,
        },
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
          isSchedulable: false,
        }),
      );
    }

    return ok(c, sources);
  });
}
