import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requirePersonApproval } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  rejectSocialPostRequestSchema,
  socialPostParamsSchema,
  socialPostSchema,
} from "@/schemas/social-post.schema";
import { rejectSocialPost } from "@/services/social-posts.service";

import {
  mapSocialPostServiceError,
  presentSocialPost,
  socialPostWebPath,
} from "../../route-helpers.js";

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "post",
    path: "/{id}/social-posts/{postId}/reject",
    description:
      "Reject a Social post that needs approval. The post is canceled and never publishes. A person does this on a browser session in the Project's Workspace; any other credential gets 403 `person_approval_required` with the post's Web link (ADR 0077).",
    tags: ["Projects"],
    request: {
      params: socialPostParamsSchema,
      body: {
        required: true,
        content: {
          "application/json": { schema: rejectSocialPostRequestSchema },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(socialPostSchema, "Social post rejected"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      409: jsonErrorResponse("Conflict"),
      422: jsonErrorResponse("Unprocessable Entity"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">): void {
  app.openapi(route, async (c) => {
    const { id: projectId, postId } = c.req.valid("param");
    const userContext = requirePersonApproval(
      c.var.authContext,
      socialPostWebPath(projectId, postId),
    );

    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const input = c.req.valid("json");

    try {
      const post = await rejectSocialPost({
        projectId,
        workspaceId: workspaceContext.workspaceId,
        userId: userContext.userId,
        postId,
        revision: input.revision,
      });
      return ok(c, socialPostSchema.parse(presentSocialPost(post)));
    } catch (error) {
      return mapSocialPostServiceError(error);
    }
  });
}
