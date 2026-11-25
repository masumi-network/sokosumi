import { createRoute } from "@hono/zod-openapi";

import {
  aiBudgetUnavailable,
  notFound,
  serviceUnavailable,
} from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { AiGatewayBudgetError } from "@/lib/ai-gateway-budget";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireProjectAccess } from "@/lib/image-studio/access";
import { limitAgentWriting } from "@/lib/image-studio/agent-writing-limit";
import { requireUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  imageStudioAssetParamsSchema,
  imageStudioCaptionSchema,
} from "@/schemas/project-image-studio.schema";
import { writeStudioAssetCaption } from "@/services/image-studio-caption.service";

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "post",
    path: "/{id}/image-studio/assets/{assetId}/caption",
    description:
      "A social caption for this studio image, written from its prompt the way Soko Bot writes.",
    tags: ["Projects"],
    request: {
      params: imageStudioAssetParamsSchema,
    },
    responses: {
      200: jsonSuccessResponse(imageStudioCaptionSchema, "Caption written"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      409: jsonErrorResponse("CMO project is read-only"),
      429: jsonErrorResponse("An agent reached its hourly limit"),
      503: jsonErrorResponse("Service Unavailable"),
    },
  }),
);

export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">): void {
  app.openapi(route, async (c) => {
    const userContext = requireUserAuthContext(c.var.authContext);
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const { id: projectId, assetId } = c.req.valid("param");

    await requireProjectAccess({
      projectId,
      workspaceId: workspaceContext.workspaceId,
      userId: userContext.userId,
    });

    await limitAgentWriting(userContext, workspaceContext.workspaceId);

    let result: Awaited<ReturnType<typeof writeStudioAssetCaption>>;
    try {
      result = await writeStudioAssetCaption({ projectId, assetId });
    } catch (error) {
      if (error instanceof AiGatewayBudgetError)
        throw aiBudgetUnavailable(error);
      throw serviceUnavailable("Could not write a caption");
    }
    if (result.isErr()) {
      if (result.error === "missing") throw notFound("Image not found");
      throw serviceUnavailable("Could not write a caption");
    }

    return ok(c, imageStudioCaptionSchema.parse({ text: result.value }));
  });
}
