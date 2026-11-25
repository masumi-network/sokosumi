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
  approveSocialPostRequestSchema,
  socialPostParamsSchema,
  socialPostSchema,
} from "@/schemas/social-post.schema";
import { approveSocialPost } from "@/services/social-posts.service";

import {
  mapSocialPostServiceError,
  presentSocialPost,
  socialPostWebPath,
} from "../../route-helpers.js";

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "post",
    path: "/{id}/social-posts/{postId}/approve",
    description:
      "Approve a Social post that needs approval. A future scheduled time stays; the post then publishes on that time. Otherwise it becomes a draft. A person does this on a browser session in the Project's Workspace; any other credential gets 403 `person_approval_required` with the post's Web link (ADR 0077).",
    tags: ["Projects"],
    request: {
      params: socialPostParamsSchema,
      body: {
        required: true,
        content: {
          "application/json": { schema: approveSocialPostRequestSchema },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(socialPostSchema, "Social post approved"),
      400: jsonErrorResponse("Bad Request"),
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
      const post = await approveSocialPost({
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
