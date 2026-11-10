import { createRoute, z } from "@hono/zod-openapi";
import {
  ENTITY_IMAGE_MAX_SIZE_BYTES,
  isStudioLogoMime,
  sniffImageMimeFromBytes,
} from "@sokosumi/utils";
import { bodyLimit } from "hono/body-limit";
import sharp from "sharp";

import {
  payloadTooLarge,
  serviceUnavailable,
  unprocessableEntity,
} from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { uploadProjectLogoBytes } from "@/lib/blob";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireProjectAccess } from "@/lib/image-studio/access";
import { requireInteractiveUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { imageStudioProjectParamsSchema } from "@/schemas/project-image-studio.schema";
import { updateProject } from "@/services/projects.service";

const path = "/{id}/image-studio/brand-kit/logo";
const invalidLogo = "Choose a readable still PNG, JPEG, or WebP image.";
const tooLarge = "The project logo must be 2 MB or smaller.";

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "post",
    path,
    operationId: "uploadStudioProjectLogo",
    tags: ["Projects"],
    request: {
      params: imageStudioProjectParamsSchema,
      body: {
        required: true,
        content: {
          "multipart/form-data": {
            schema: z.object({
              file: z.any().openapi({ type: "string", format: "binary" }),
            }),
          },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(
        z.object({ logo: z.string().url() }),
        "Project logo updated",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      413: jsonErrorResponse("Logo is too large"),
      422: jsonErrorResponse("Logo is not a supported image"),
      503: jsonErrorResponse("Logo storage is unavailable"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.use(
    "/:id/image-studio/brand-kit/logo",
    bodyLimit({
      maxSize: ENTITY_IMAGE_MAX_SIZE_BYTES + 256 * 1024,
      onError: () => {
        throw payloadTooLarge(tooLarge);
      },
    }),
  );

  app.openapi(route, async (c) => {
    const { userId } = requireInteractiveUserAuthContext(c.var.authContext);
    const { workspaceId } = requireWorkspaceContext(c.var.workspaceContext);
    const { id: projectId } = c.req.valid("param");
    const scope = { projectId, userId, workspaceId };
    await requireProjectAccess(scope);

    const { file } = await c.req.parseBody();
    if (!(file instanceof File) || !file.size)
      throw unprocessableEntity(invalidLogo);
    if (file.size > ENTITY_IMAGE_MAX_SIZE_BYTES)
      throw payloadTooLarge(tooLarge);
    const bytes = Buffer.from(await file.arrayBuffer());
    const contentType = sniffImageMimeFromBytes(bytes);
    if (!contentType || !isStudioLogoMime(contentType)) {
      throw unprocessableEntity(invalidLogo);
    }

    try {
      const image = sharp(bytes, { limitInputPixels: 4_000_000 });
      const { pages = 1 } = await image.metadata();
      if (pages > 1) throw new Error("The logo has multiple frames");
      await image.stats();
    } catch {
      throw unprocessableEntity(invalidLogo);
    }

    const logo = await uploadProjectLogoBytes({
      projectId,
      bytes,
      contentType,
    });
    if (!logo) throw serviceUnavailable("Could not save the project logo.");
    await requireProjectAccess(scope);
    await updateProject(workspaceId, projectId, { logo });
    return ok(c, { logo });
  });
}
