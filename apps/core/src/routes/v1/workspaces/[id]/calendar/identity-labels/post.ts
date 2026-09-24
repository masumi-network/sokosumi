import { createRoute, z } from "@hono/zod-openapi";

import { requireCalendarBetaAccess } from "@/helpers/calendar-beta-access";
import { forbidden, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { resolveMemberOrganizationById } from "@/helpers/organization";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  calendarIdentityLabelsRequestSchema,
  calendarIdentityLabelsSchema,
} from "@/schemas/workspace-calendar.schema";

const paramsSchema = z.object({
  id: z
    .string()
    .uuid()
    .openapi({
      param: { name: "id", in: "path" },
      example: "11111111-1111-7111-8111-111111111111",
    }),
});

const route = createRoute({
  method: "post",
  path: "/{id}/calendar/identity-labels",
  description:
    "Resolve opaque Calendar actor references without revealing identities outside the active workspace",
  tags: ["Workspaces"],
  request: {
    params: paramsSchema,
    body: {
      content: {
        "application/json": { schema: calendarIdentityLabelsRequestSchema },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      calendarIdentityLabelsSchema,
      "Access-scoped Calendar identity labels",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireOwnerUserContext(c.var.authContext);
    await requireCalendarBetaAccess(userContext.userId, prisma);

    const { id: workspaceId } = c.req.valid("param");
    const activeWorkspace = requireWorkspaceContext(c.var.workspaceContext);
    if (activeWorkspace.workspaceId !== workspaceId) {
      throw forbidden(
        "You can only resolve identities in the active workspace",
      );
    }

    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { userId: true, organizationId: true },
    });
    if (!workspace) {
      throw notFound("Workspace not found");
    }

    if (workspace.organizationId) {
      await resolveMemberOrganizationById({
        id: workspace.organizationId,
        userId: userContext.userId,
        tx: prisma,
      });
    } else if (workspace.userId !== userContext.userId) {
      throw forbidden("You do not have access to this workspace");
    }

    const requestedRefs = [...new Set(c.req.valid("json").refs)];
    const [occurrenceActors, projectEventActors, taskEventActors] =
      await Promise.all([
        prisma.taskScheduleRun.findMany({
          where: {
            sourceWorkspaceId: workspaceId,
            actorUserId: { in: requestedRefs },
          },
          distinct: ["actorUserId"],
          select: { actorUserId: true },
        }),
        prisma.projectEvent.findMany({
          where: {
            project: { workspaceId },
            actorUserId: { in: requestedRefs },
          },
          distinct: ["actorUserId"],
          select: { actorUserId: true },
        }),
        prisma.taskEvent.findMany({
          where: {
            task: { workspaceId },
            scheduleKind: { not: null },
            userId: { in: requestedRefs },
          },
          distinct: ["userId"],
          select: { userId: true },
        }),
      ]);

    const provenRefs = new Set<string>();
    for (const { actorUserId } of occurrenceActors) {
      if (actorUserId) provenRefs.add(actorUserId);
    }
    for (const { actorUserId } of projectEventActors) {
      if (actorUserId) provenRefs.add(actorUserId);
    }
    for (const { userId } of taskEventActors) {
      if (userId) provenRefs.add(userId);
    }

    const currentActors =
      provenRefs.size === 0
        ? []
        : await prisma.user.findMany({
            where: {
              id: { in: [...provenRefs] },
              ...(workspace.organizationId
                ? {
                    members: {
                      some: { organizationId: workspace.organizationId },
                    },
                  }
                : { workspace: { id: workspaceId } }),
            },
            select: { id: true, name: true },
          });
    const currentActorByRef = new Map(
      currentActors.map((actor) => [actor.id, actor.name]),
    );
    const labels = requestedRefs.map((ref) => {
      const label = currentActorByRef.get(ref);
      if (label !== undefined) {
        return { ref, state: "current_member" as const, label };
      }
      if (provenRefs.has(ref)) {
        return { ref, state: "former_member" as const };
      }
      return { ref, state: "unknown" as const };
    });

    c.header("Cache-Control", "private, max-age=300");
    return ok(c, calendarIdentityLabelsSchema.parse(labels));
  });
}
