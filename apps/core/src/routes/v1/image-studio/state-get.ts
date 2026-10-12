import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireWorkspaceAccess } from "@/lib/image-studio/access";
import { requireInteractiveUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  assetContentPath,
  imageStudioStateQuerySchema,
  imageStudioWorkspaceStateSchema,
} from "@/schemas/project-image-studio.schema";
import { listAssets, listJobs } from "@/services/image-studio-assets.service";
import { reconcileWorkspaceJobs } from "@/services/image-studio-jobs.service";

const ASSET_PAGE = 100;
const JOB_PAGE = 50;

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "get",
    path: "/state",
    description:
      "Image studio state across every Project in the workspace: versions and recent generation jobs, newest first, each carrying the Project it belongs to. The workspace-wide counterpart of GET /v1/projects/{id}/image-studio. Generating still happens per Project.",
    tags: ["Image Studio"],
    request: { query: imageStudioStateQuerySchema },
    responses: {
      200: jsonSuccessResponse(
        imageStudioWorkspaceStateSchema,
        "Workspace image studio state",
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
    const query = c.req.valid("query");
    const scope = {
      projectId: null,
      workspaceId: workspaceContext.workspaceId,
      userId: userContext.userId,
    };

    // Ahead of the reconcile for the same reason as the project route: it makes
    // provider calls, and only a member may cause them.
    await requireWorkspaceAccess(scope);
    await reconcileWorkspaceJobs(scope.workspaceId);

    const [assetPage, jobs] = await Promise.all([
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
    ]);

    return ok(
      c,
      imageStudioWorkspaceStateSchema.parse({
        assets: assetPage.assets.map((asset) => ({
          ...asset,
          contentPath: assetContentPath(asset.projectId, asset.id),
        })),
        jobs,
        nextCursor: assetPage.nextCursor,
      }),
    );
  });
}
