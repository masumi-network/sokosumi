import { createRoute } from "@hono/zod-openapi";

import { notFound, unprocessableEntity } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { serializableTransaction } from "@/lib/db/transaction";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireProjectAccess } from "@/lib/image-studio/access";
import { requireInteractiveUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  imageStudioAssetParamsSchema,
  saveStudioAdHeadlineSchema,
  studioAdHeadlineSchema,
} from "@/schemas/project-image-studio.schema";
import { parseBrandBrain } from "@/services/brand-brain.service";

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "put",
    path: "/{id}/image-studio/assets/{assetId}/headline",
    operationId: "saveStudioAdHeadline",
    tags: ["Projects"],
    request: {
      params: imageStudioAssetParamsSchema,
      body: {
        required: true,
        content: { "application/json": { schema: saveStudioAdHeadlineSchema } },
      },
    },
    responses: {
      200: jsonSuccessResponse(studioAdHeadlineSchema, "Saved export headline"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Image not found"),
      409: jsonErrorResponse("Headline save conflict"),
      422: jsonErrorResponse("Headline is unavailable in Brand Kit"),
    },
  }),
);

export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">): void {
  app.openapi(route, async (c) => {
    const { userId } = requireInteractiveUserAuthContext(c.var.authContext);
    const { workspaceId } = requireWorkspaceContext(c.var.workspaceContext);
    const { id: projectId, assetId } = c.req.valid("param");
    const { text } = c.req.valid("json");
    const headline = await serializableTransaction(async (tx) => {
      await requireProjectAccess({ projectId, workspaceId, userId }, tx);
      const asset = await tx.projectImageAsset.findFirst({
        where: { id: assetId, projectId, workspaceId, mediaType: "IMAGE" },
        select: {
          headline: { select: { text: true, revision: true } },
          project: { select: { brandBrain: { select: { body: true } } } },
        },
      });
      if (!asset) throw notFound("Image not found");
      const brand = parseBrandBrain(asset.project.brandBrain?.body);
      if (text !== null && !brand?.voice.examples.includes(text)) {
        throw unprocessableEntity(
          "Headline is no longer approved in Brand Kit",
        );
      }
      if ((asset.headline?.text ?? null) === text) {
        return asset.headline ?? { text: null, revision: 0 };
      }
      return tx.projectImageHeadline.upsert({
        where: { assetId },
        create: { assetId, text },
        update: { text, revision: { increment: 1 } },
        select: { text: true, revision: true },
      });
    }, "The ad headline changed. Try saving it again.");
    return ok(c, studioAdHeadlineSchema.parse(headline));
  });
}
