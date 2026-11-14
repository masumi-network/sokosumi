import { createRoute, z } from "@hono/zod-openapi";
import {
  jsonErrorResponse,
  jsonPaginatedSuccessResponse,
} from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { requireSocialPostActor } from "@/helpers/social-post-access";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  listWorkspaceSocialPostsQuerySchema,
  workspaceSocialPostSchema,
} from "@/schemas/social-post.schema";
import { cmoProjectIds } from "@/services/cmo-cuso.service";
import { listWorkspaceSocialPosts } from "@/services/social-posts.service";

import {
  mapSocialPostServiceError,
  presentSocialPost,
} from "../../projects/[id]/social-posts/route-helpers.js";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/social-posts",
    description:
      "List the Social posts of every Project in the active workspace, each with its Project's name. Same access as listing one Project's Social posts.",
    tags: ["Workspaces"],
    request: {
      query: listWorkspaceSocialPostsQuerySchema,
    },
    responses: {
      200: jsonPaginatedSuccessResponse(
        z.array(workspaceSocialPostSchema),
        "Social posts with their Project",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      422: jsonErrorResponse("Unprocessable Entity"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">): void {
  app.openapi(route, async (c) => {
    const userContext = await requireSocialPostActor(c.var.authContext);
    const { workspaceId } = requireWorkspaceContext(c.var.workspaceContext);
    const { status: statuses, cursor, limit } = c.req.valid("query");

    try {
      const { posts, pagination } = await listWorkspaceSocialPosts({
        workspaceId,
        statuses,
        cursor,
        limit,
      });
      const projectIds = [...new Set(posts.map((post) => post.projectId))];
      const [projects, cmoProjects] = await Promise.all([
        prisma.project.findMany({
          where: { workspaceId, id: { in: projectIds } },
          select: { id: true, name: true },
        }),
        cmoProjectIds(projectIds),
      ]);
      const names = new Map(
        projects.map((project) => [project.id, project.name]),
      );
      return ok(
        c,
        z.array(workspaceSocialPostSchema).parse(
          posts.map((post) => ({
            post: presentSocialPost(post, userContext.coworkerId),
            projectName: names.get(post.projectId) ?? "",
            projectCmo: cmoProjects.has(post.projectId),
          })),
        ),
        pagination,
      );
    } catch (error) {
      return mapSocialPostServiceError(error);
    }
  });
}
