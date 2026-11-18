import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireProjectAccess } from "@/lib/image-studio/access";
import { requireInteractiveUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  assetContentPath,
  imageStudioProjectParamsSchema,
  imageStudioTalkingVideosSchema,
} from "@/schemas/project-image-studio.schema";
import {
  listAssetsOfJobs,
  listJobs,
} from "@/services/image-studio-assets.service";
import { reconcileProjectJobs } from "@/services/image-studio-jobs.service";

const JOB_PAGE = 30;

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "get",
    path: "/{id}/image-studio/talking-videos",
    description:
      "A Project's talking videos: the newest jobs and the videos they delivered. Polled while one is being made; answering it settles finished jobs, like the studio state.",
    tags: ["Projects"],
    request: { params: imageStudioProjectParamsSchema },
    responses: {
      200: jsonSuccessResponse(
        imageStudioTalkingVideosSchema,
        "The Project's talking videos",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
    },
  }),
);

export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">): void {
  app.openapi(route, async (c) => {
    const userContext = requireInteractiveUserAuthContext(c.var.authContext);
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const { id: projectId } = c.req.valid("param");
    const scope = {
      projectId,
      workspaceId: workspaceContext.workspaceId,
      userId: userContext.userId,
    };
    await requireProjectAccess(scope);
    await reconcileProjectJobs(projectId);

    const jobs = await listJobs({
      ...scope,
      limit: JOB_PAGE,
      kind: "TALKING_VIDEO",
    });
    const assets = await listAssetsOfJobs(
      jobs.map((job) => job.id),
      userContext.userId,
    );
    return ok(
      c,
      imageStudioTalkingVideosSchema.parse({
        jobs,
        assets: assets.map((asset) => ({
          ...asset,
          contentPath: assetContentPath(projectId, asset.id),
        })),
      }),
    );
  });
}
