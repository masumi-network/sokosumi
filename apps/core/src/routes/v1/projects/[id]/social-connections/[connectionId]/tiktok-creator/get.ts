import { createRoute } from "@hono/zod-openapi";
import { deleteComposioToolSession } from "@/clients/composio.client";
import {
  createComposioToolSession,
  executeComposioTool,
} from "@/clients/social-post-providers/tools";
import { getZernioTikTokCreatorInfo } from "@/clients/social-post-providers/zernio-tiktok";
import { getZernioAccountId } from "@/clients/zernio.client";
import {
  requireSocialProviderEnabled,
  socialProviderProjectSelect,
} from "@/config/social-providers";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireInteractiveUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  projectSocialConnectionParamsSchema,
  tikTokCreatorInfoSchema,
} from "@/schemas/project-social-connection.schema";
import { projectExecutorUserId } from "@/services/project-social-connections.service";

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "get",
    path: "/{id}/social-connections/{connectionId}/tiktok-creator",
    tags: ["Projects"],
    description:
      "Read the connected TikTok creator’s current posting options before consent.",
    request: { params: projectSocialConnectionParamsSchema },
    responses: {
      200: jsonSuccessResponse(
        tikTokCreatorInfoSchema,
        "Current TikTok creator settings",
      ),
      400: jsonErrorResponse("Bad Request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      422: jsonErrorResponse("Unprocessable Entity"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);
export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">) {
  app.openapi(route, async (c) => {
    requireInteractiveUserAuthContext(c.var.authContext);
    const { workspaceId } = requireWorkspaceContext(c.var.workspaceContext);
    const { id: projectId, connectionId } = c.req.valid("param");
    const connection = await prisma.projectSocialConnection.findFirst({
      where: {
        id: connectionId,
        projectId,
        project: { workspaceId },
        status: "active",
        provider: "tiktok",
      },
      select: {
        composioConnectedAccountId: true,
        project: { select: socialProviderProjectSelect },
      },
    });
    if (!connection) throw notFound("Active TikTok connection not found");
    requireSocialProviderEnabled("tiktok", connection.project);
    c.header("Cache-Control", "no-store");
    const zernioAccountId = getZernioAccountId(
      connection.composioConnectedAccountId,
    );
    if (zernioAccountId) {
      return ok(
        c,
        await getZernioTikTokCreatorInfo(zernioAccountId, c.req.raw.signal),
      );
    }
    const toolSlug = "TIKTOK_QUERY_CREATOR_INFO";
    const sessionId = await createComposioToolSession({
      toolkitSlug: "tiktok",
      connectedAccountId: connection.composioConnectedAccountId,
      executorUserId: projectExecutorUserId(projectId),
      toolSlugs: [toolSlug],
      context: "read TikTok posting options",
    });
    try {
      const info = await executeComposioTool({
        sessionId,
        toolSlug,
        arguments: {},
        context: "read TikTok creator info",
        refused: "TikTok refused the creator info",
      });
      const creator = tikTokCreatorInfoSchema.parse(info);
      return ok(c, {
        ...creator,
        privacy_level_options: creator.privacy_level_options.filter(
          (level) => level === "SELF_ONLY",
        ),
      });
    } finally {
      await deleteComposioToolSession(
        sessionId,
        "delete TikTok creator info session",
      );
    }
  });
}
