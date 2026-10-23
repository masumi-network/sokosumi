import { createRoute, z } from "@hono/zod-openapi";
import { CalendarSourceType } from "@sokosumi/database";
import { getCalendarSourceId } from "@/helpers/calendar-source";
import { requireAuthorizedUserContext } from "@/helpers/coworker-user-context-binding";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { requireSocialBetaAccess } from "@/helpers/social-beta-access";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { isNewsletterEnabled } from "@/lib/newsletter/feature";
import { requireInteractiveUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  workspaceCalendarSourceSchema,
  workspaceCalendarSourcesQuerySchema,
} from "@/schemas/workspace-calendar.schema";
import { canCreateTaskSchedules } from "@/services/task-schedule.service";
import { scheduledNewsletterIssueWhere } from "../read-newsletter-issues.js";
import { scheduledSocialPostWhere } from "../social-post-range.js";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/calendar/sources",
    description:
      "List workspace and Project Calendar sources, including sources only available for event display and filtering",
    tags: ["Workspaces"],
    request: { query: workspaceCalendarSourcesQuerySchema },
    responses: {
      200: jsonSuccessResponse(
        z.array(workspaceCalendarSourceSchema),
        "Workspace Calendar sources with scheduling availability",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      422: jsonErrorResponse("Unprocessable Entity"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const userContext = await requireAuthorizedUserContext(c.var.authContext);
    const query = c.req.valid("query");
    const includeSocialPosts = query.includeSocialPosts === "true";
    if (includeSocialPosts) {
      requireInteractiveUserAuthContext(c.var.authContext);
      await requireSocialBetaAccess(userContext.userId, prisma);
    }
    const workspaceId = workspaceContext.workspaceId;
    const isSchedulable = await canCreateTaskSchedules(c.var);

    const [workspace, projects, latestPostDates, latestIssueDates] =
      await Promise.all([
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
        includeSocialPosts
          ? prisma.socialPost.groupBy({
              by: ["projectId"],
              where: scheduledSocialPostWhere(
                workspaceId,
                userContext.userId,
                query.scope,
              ),
              _max: { scheduledAt: true },
            })
          : [],
        includeSocialPosts && isNewsletterEnabled()
          ? prisma.newsletterIssue.groupBy({
              by: ["projectId"],
              where: scheduledNewsletterIssueWhere(
                workspaceId,
                userContext.userId,
                query.scope,
              ),
              _max: { scheduledAt: true },
            })
          : [],
      ]);
    if (!workspace) {
      throw notFound("Workspace not found");
    }

    const workspaceOwner = workspace.organization ?? workspace.user;
    const latestPostByProject = new Map(
      latestPostDates.map((post) => [post.projectId, post._max.scheduledAt]),
    );
    const latestIssueByProject = new Map(
      latestIssueDates.map((issue) => [
        issue.projectId,
        issue._max.scheduledAt,
      ]),
    );
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
          ...(includeSocialPosts
            ? {
                latestScheduledSocialPostAt:
                  latestPostByProject.get(project.id) ?? null,
                ...(isNewsletterEnabled()
                  ? {
                      latestScheduledNewsletterIssueAt:
                        latestIssueByProject.get(project.id) ?? null,
                    }
                  : {}),
              }
            : {}),
        }),
      ),
    ];

    return ok(c, sources);
  });
}
