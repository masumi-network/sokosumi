import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireProjectAccess } from "@/lib/image-studio/access";
import {
  prepareStudioWebsiteDraft,
  readStudioBrandKit,
  readStudioWebsiteCopy,
  saveStudioBrandLook,
} from "@/lib/image-studio/studio-brand";
import { requireInteractiveUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { imageStudioProjectParamsSchema } from "@/schemas/project-image-studio.schema";
import {
  saveStudioBrandCopySchema,
  saveStudioBrandLookSchema,
  studioBrandKitSchema,
  studioBrandLookStateSchema,
  studioWebsiteCopySchema,
  studioWebsiteDraftSchema,
} from "@/schemas/studio-brand-kit.schema";
import { saveStudioBrandCopy } from "@/services/brand-brain.service";

const path = "/{id}/image-studio/brand-kit";
const websiteDraftPath = "/{id}/image-studio/website-draft";
const tags = ["Projects"];
const accessErrors = {
  401: jsonErrorResponse("Unauthorized"),
  403: jsonErrorResponse("Forbidden"),
  404: jsonErrorResponse("Not Found"),
};
const websiteDraftResponses = {
  200: jsonSuccessResponse(
    studioWebsiteDraftSchema,
    "Website suggestions for review",
  ),
  ...accessErrors,
  422: jsonErrorResponse("Project website missing"),
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

const lookRoute = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "put",
    path: `${path}/look`,
    operationId: "saveStudioBrandLook",
    tags,
    request: {
      params: imageStudioProjectParamsSchema,
      body: {
        required: true,
        content: { "application/json": { schema: saveStudioBrandLookSchema } },
      },
    },
    responses: {
      200: jsonSuccessResponse(
        studioBrandLookStateSchema,
        "Studio brand look saved",
      ),
      ...accessErrors,
      409: jsonErrorResponse("Brand look changed"),
      422: jsonErrorResponse("Unprocessable Entity"),
    },
  }),
);

const websiteCopyRoute = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "get",
    path: `${path}/website-copy`,
    operationId: "getStudioWebsiteCopy",
    tags,
    request: { params: imageStudioProjectParamsSchema },
    responses: {
      200: jsonSuccessResponse(studioWebsiteCopySchema, "Website copy draft"),
      ...accessErrors,
      422: jsonErrorResponse("Project website missing"),
      502: jsonErrorResponse("Website could not be read"),
    },
  }),
);

const websiteDraftRoute = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "get",
    path: websiteDraftPath,
    operationId: "prepareStudioWebsiteDraft",
    tags,
    request: { params: imageStudioProjectParamsSchema },
    responses: websiteDraftResponses,
  }),
);

const websiteResearchRoute = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "post",
    path: websiteDraftPath,
    operationId: "researchStudioWebsiteDraft",
    description:
      "Prepare a website draft with optional brand voice and audience suggestions.",
    tags,
    request: { params: imageStudioProjectParamsSchema },
    responses: websiteDraftResponses,
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

  app.openapi(websiteCopyRoute, async (c) => {
    const { userId } = requireInteractiveUserAuthContext(c.var.authContext);
    const { workspaceId } = requireWorkspaceContext(c.var.workspaceContext);
    const { id: projectId } = c.req.valid("param");
    await requireProjectAccess({ userId, workspaceId, projectId });
    return ok(c, await readStudioWebsiteCopy(projectId));
  });

  app.openapi(websiteDraftRoute, async (c) => {
    const { userId } = requireInteractiveUserAuthContext(c.var.authContext);
    const { workspaceId } = requireWorkspaceContext(c.var.workspaceContext);
    const { id: projectId } = c.req.valid("param");
    await requireProjectAccess({ userId, workspaceId, projectId });
    return ok(c, await prepareStudioWebsiteDraft(projectId));
  });

  app.openapi(websiteResearchRoute, async (c) => {
    const { userId } = requireInteractiveUserAuthContext(c.var.authContext);
    const { workspaceId } = requireWorkspaceContext(c.var.workspaceContext);
    const { id: projectId } = c.req.valid("param");
    await requireProjectAccess({ userId, workspaceId, projectId });
    return ok(c, await prepareStudioWebsiteDraft(projectId, workspaceId));
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

  app.openapi(lookRoute, async (c) => {
    const { userId } = requireInteractiveUserAuthContext(c.var.authContext);
    const { workspaceId } = requireWorkspaceContext(c.var.workspaceContext);
    const { id: projectId } = c.req.valid("param");
    await requireProjectAccess({ userId, workspaceId, projectId });
    return ok(
      c,
      await saveStudioBrandLook(projectId, workspaceId, c.req.valid("json")),
    );
  });
}
