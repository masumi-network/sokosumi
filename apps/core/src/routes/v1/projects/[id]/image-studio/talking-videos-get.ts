import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { createNetworkScope } from "@/lib/db/network-scope";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireProjectAccess } from "@/lib/image-studio/access";
import { requireUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  assetContentPath,
  imageStudioProjectParamsSchema,
  imageStudioStateQuerySchema,
  imageStudioTalkingVideosSchema,
} from "@/schemas/project-image-studio.schema";
import {
  listAssetsOfJobs,
  listJobs,
} from "@/services/image-studio-assets.service";
import { reconcileProjectJobs } from "@/services/image-studio-jobs.service";

const JOB_PAGE = 30;

const talkingVideoPageSchema = imageStudioTalkingVideosSchema.and(
  z.object({ hasMore: z.boolean().optional() }),
);

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "get",
    path: "/{id}/image-studio/talking-videos",
    description:
      "A Project's talking videos: jobs and their delivered videos, newest first. Pass the oldest job's createdAt and id to read the next 30. Reading the newest page settles finished jobs, like the studio state.",
    tags: ["Projects"],
    request: {
      params: imageStudioProjectParamsSchema,
      query: imageStudioStateQuerySchema
        .pick({ before: true, beforeId: true })
        .refine((query) => Boolean(query.before) === Boolean(query.beforeId), {
          message: "Provide both before and beforeId for an older page",
        }),
    },
    responses: {
      200: jsonSuccessResponse(
        talkingVideoPageSchema,
        "The Project's talking videos",
      ),
      400: jsonErrorResponse("Invalid history cursor"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
    },
  }),
);

export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">): void {
  app.openapi(route, async (c) => {
    const userContext = requireUserAuthContext(c.var.authContext);
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const { id: projectId } = c.req.valid("param");
    const { before, beforeId } = c.req.valid("query");
    const scope = {
      projectId,
      workspaceId: workspaceContext.workspaceId,
      userId: userContext.userId,
    };
    await requireProjectAccess(scope);
    // Image Studio is Mainnet only: the charge does not follow the request's Network.
    if (!before)
      await reconcileProjectJobs(createNetworkScope("mainnet"), projectId);

    const page = await listJobs({
      ...scope,
      limit: JOB_PAGE + 1,
      kind: "TALKING_VIDEO",
      ...(before && beforeId
        ? { before: { createdAt: new Date(before), id: beforeId } }
        : {}),
    });
    const jobs = page.slice(0, JOB_PAGE);
    const assets = await listAssetsOfJobs(
      jobs.map((job) => job.id),
      userContext.userId,
    );
    return ok(
      c,
      talkingVideoPageSchema.parse({
        hasMore: page.length > JOB_PAGE,
        jobs,
        assets: assets.map((asset) => ({
          ...asset,
          contentPath: assetContentPath(projectId, asset.id),
        })),
      }),
    );
  });
}
