import { createRoute, z } from "@hono/zod-openapi";

import { unprocessableEntity } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { serializableTransaction } from "@/lib/db/transaction";
import { resolveFileActor } from "@/lib/files/actor";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireProjectAccess } from "@/lib/image-studio/access";
import { requireStudioReferenceFiles } from "@/lib/image-studio/reference-files";
import {
  prepareStudioWebsiteDraft,
  readStudioBrandKit,
  readStudioWebsiteCopy,
  saveStudioBrandLook,
} from "@/lib/image-studio/studio-brand";
import { requireUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { imageStudioProjectParamsSchema } from "@/schemas/project-image-studio.schema";
import {
  saveStudioBrandCopySchema,
  saveStudioBrandLookSchema,
  studioBrandAssetsSchema,
  studioBrandKitSchema,
  studioBrandLookStateSchema,
  studioWebsiteCopySchema,
  studioWebsiteDraftSchema,
  updateStudioBrandAssetsSchema,
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

const assetsRoute = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "patch",
    path: `${path}/assets`,
    operationId: "updateStudioBrandAssets",
    tags,
    request: {
      params: imageStudioProjectParamsSchema,
      body: {
        required: true,
        content: {
          "application/json": { schema: updateStudioBrandAssetsSchema },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(studioBrandAssetsSchema, "Updated brand images"),
      ...accessErrors,
      409: jsonErrorResponse("Concurrent edit"),
      422: jsonErrorResponse("Invalid reference image or full brand kit"),
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
      "Prepare website copy, products, visual suggestions, and a logo candidate for review.",
    tags,
    request: { params: imageStudioProjectParamsSchema },
    responses: {
      ...websiteDraftResponses,
      409: jsonErrorResponse("CMO project is read-only"),
    },
  }),
);

export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">) {
  app.openapi(getRoute, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { workspaceId } = requireWorkspaceContext(c.var.workspaceContext);
    const { id: projectId } = c.req.valid("param");
    await requireProjectAccess({ userId, workspaceId, projectId });
    return ok(c, await readStudioBrandKit(projectId));
  });

  app.openapi(websiteCopyRoute, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { workspaceId } = requireWorkspaceContext(c.var.workspaceContext);
    const { id: projectId } = c.req.valid("param");
    await requireProjectAccess({ userId, workspaceId, projectId });
    return ok(c, await readStudioWebsiteCopy(projectId));
  });

  app.openapi(websiteDraftRoute, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { workspaceId } = requireWorkspaceContext(c.var.workspaceContext);
    const { id: projectId } = c.req.valid("param");
    await requireProjectAccess({ userId, workspaceId, projectId });
    return ok(c, await prepareStudioWebsiteDraft(projectId));
  });

  app.openapi(websiteResearchRoute, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { workspaceId } = requireWorkspaceContext(c.var.workspaceContext);
    const { id: projectId } = c.req.valid("param");
    await requireProjectAccess({ userId, workspaceId, projectId });
    return ok(c, await prepareStudioWebsiteDraft(projectId, workspaceId));
  });

  app.openapi(putRoute, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { workspaceId } = requireWorkspaceContext(c.var.workspaceContext);
    const { id: projectId } = c.req.valid("param");
    await requireProjectAccess({ userId, workspaceId, projectId });
    const { copy, version } = c.req.valid("json");
    return ok(c, {
      version: await saveStudioBrandCopy(projectId, copy, version),
    });
  });

  app.openapi(assetsRoute, async (c) => {
    const user = requireUserAuthContext(c.var.authContext);
    const { workspaceId, organizationId } = requireWorkspaceContext(
      c.var.workspaceContext,
    );
    const { id: projectId } = c.req.valid("param");
    const change = c.req.valid("json");
    const assets = await serializableTransaction(async (tx) => {
      await requireProjectAccess(
        { projectId, workspaceId, userId: user.userId },
        tx,
      );
      const project = await tx.project.findUniqueOrThrow({
        where: { id: projectId, workspaceId },
        select: { studioBrandAssets: true },
      });
      const current = studioBrandAssetsSchema.parse(
        project.studioBrandAssets ?? [],
      );
      let next;
      if ("add" in change) {
        await requireStudioReferenceFiles(
          {
            workspaceId,
            actor: resolveFileActor(
              { source: "session", ...user },
              { organizationId },
            ),
            resourceIds: [change.add.id],
          },
          tx,
        );
        if (current.some(({ id }) => id === change.add.id)) return current;
        next = [...current, change.add];
        if (!studioBrandAssetsSchema.safeParse(next).success)
          throw unprocessableEntity("The brand kit holds up to 20 images.");
      } else {
        next = current.filter(({ id }) => id !== change.remove);
      }
      await tx.project.update({
        where: { id: projectId },
        data: { studioBrandAssets: next },
      });
      return next;
    }, "The brand images changed. Try again.");
    return ok(c, assets);
  });

  app.openapi(lookRoute, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { workspaceId } = requireWorkspaceContext(c.var.workspaceContext);
    const { id: projectId } = c.req.valid("param");
    await requireProjectAccess({ userId, workspaceId, projectId });
    return ok(
      c,
      await saveStudioBrandLook(projectId, workspaceId, c.req.valid("json")),
    );
  });
}
