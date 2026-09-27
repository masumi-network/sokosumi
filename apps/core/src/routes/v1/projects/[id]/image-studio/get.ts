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
  imageStudioListSchema,
  imageStudioProjectParamsSchema,
  imageStudioStateQuerySchema,
} from "@/schemas/project-image-studio.schema";
import { listAssets, listJobs } from "@/services/image-studio-assets.service";
import { reconcileProjectJobs } from "@/services/image-studio-jobs.service";
import { listSessions } from "@/services/image-studio-sessions.service";

const ASSET_PAGE = 100;
const JOB_PAGE = 50;
const SESSION_PAGE = 30;

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "get",
    path: "/{id}/image-studio",
    description:
      "Image studio state for a Project: versions with their review decisions, recent generation jobs, and the conversations bound to this Project.",
    tags: ["Projects"],
    request: {
      params: imageStudioProjectParamsSchema,
      query: imageStudioStateQuerySchema,
    },
    responses: {
      200: jsonSuccessResponse(imageStudioListSchema, "Image studio state"),
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
    const query = c.req.valid("query");
    const scope = {
      projectId,
      workspaceId: workspaceContext.workspaceId,
      userId: userContext.userId,
    };

    // Ahead of the reconcile, not only inside the reads below: reconciling
    // makes provider calls, and an unauthorized caller must not be able to
    // spend them by naming a project id.
    await requireProjectAccess(scope);

    // Settle anything the provider has already finished before reporting
    // state. Without this a deployment fal cannot call back would show
    // "Generating" for ever.
    await reconcileProjectJobs(projectId);

    const [assetPage, jobs, sessions] = await Promise.all([
      listAssets({
        ...scope,
        limit: ASSET_PAGE,
        ...(query.before && query.beforeId
          ? {
              before: { createdAt: new Date(query.before), id: query.beforeId },
            }
          : {}),
        ...(query.assetId ? { pinnedAssetId: query.assetId } : {}),
      }),
      listJobs({ ...scope, limit: JOB_PAGE }),
      listSessions({ ...scope, limit: SESSION_PAGE }),
    ]);

    return ok(
      c,
      imageStudioListSchema.parse({
        assets: assetPage.assets.map((asset) => ({
          ...asset,
          contentPath: assetContentPath(projectId, asset.id),
          // Omit rather than send null: see the schema comment on `review`.
          review: asset.review ?? undefined,
        })),
        jobs,
        sessions,
        nextCursor: assetPage.nextCursor,
      }),
    );
  });
}
