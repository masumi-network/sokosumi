import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireProjectAccess } from "@/lib/image-studio/access";
import { readStudioBrandKit } from "@/lib/image-studio/studio-brand";
import { requireInteractiveUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { imageStudioProjectParamsSchema } from "@/schemas/project-image-studio.schema";
import {
  saveStudioBrandCopySchema,
  studioBrandKitSchema,
} from "@/schemas/studio-brand-kit.schema";
import { saveStudioBrandCopy } from "@/services/brand-brain.service";

const path = "/{id}/image-studio/brand-kit";
const tags = ["Projects"];
const accessErrors = {
  401: jsonErrorResponse("Unauthorized"),
  403: jsonErrorResponse("Forbidden"),
  404: jsonErrorResponse("Not Found"),
};

const getRoute = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "get",
    path,
    operationId: "getStudioBrandKit",
    tags,
    request: { params: imageStudioProjectParamsSchema },
    responses: {
      200: jsonSuccessResponse(studioBrandKitSchema, "Studio brand kit"),
      ...accessErrors,
    },
  }),
);

const putRoute = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "put",
    path,
    operationId: "saveStudioBrandCopy",
    tags,
    request: {
      params: imageStudioProjectParamsSchema,
      body: {
        required: true,
        content: { "application/json": { schema: saveStudioBrandCopySchema } },
      },
    },
    responses: {
      200: jsonSuccessResponse(
        z.object({ version: z.string().datetime() }),
        "Studio brand copy saved",
      ),
      ...accessErrors,
      409: jsonErrorResponse("Brand kit changed"),
      422: jsonErrorResponse("Unprocessable Entity"),
    },
  }),
);

export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">) {
  app.openapi(getRoute, async (c) => {
    const { userId } = requireInteractiveUserAuthContext(c.var.authContext);
    const { workspaceId } = requireWorkspaceContext(c.var.workspaceContext);
    const { id: projectId } = c.req.valid("param");
    await requireProjectAccess({ userId, workspaceId, projectId });
    return ok(c, await readStudioBrandKit(projectId));
  });

  app.openapi(putRoute, async (c) => {
    const { userId } = requireInteractiveUserAuthContext(c.var.authContext);
    const { workspaceId } = requireWorkspaceContext(c.var.workspaceContext);
    const { id: projectId } = c.req.valid("param");
    await requireProjectAccess({ userId, workspaceId, projectId });
    const { copy, version } = c.req.valid("json");
    return ok(c, {
      version: await saveStudioBrandCopy(projectId, copy, version),
    });
  });
}
