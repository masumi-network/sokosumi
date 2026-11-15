import { createRoute } from "@hono/zod-openapi";

import { requireAuthorizedUserContext } from "@/helpers/coworker-user-context-binding";
import {
  drivePathOf,
  requireDriveFileAccess,
} from "@/helpers/drive-file-access";
import { parseDriveFilePathname } from "@/helpers/drive-file-pathname";
import { resolveDriveTasksWorkspace } from "@/helpers/drive-tasks-workspace";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse } from "@/helpers/openapi";
import { driveDel, driveExists } from "@/lib/drive-blob";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { deleteDriveFileRequestSchema } from "@/schemas/drive-file.schema";
import { requireNotCmoDriveFile } from "@/services/cmo-cuso.service";
import { tombstoneDriveUploadResource } from "@/services/file-catalog.service";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "delete",
    path: "/delete",
    description: [
      "Delete a drive file by pathname.",
      "Personal: owner only.",
      "Organization: any member.",
    ].join("\n"),
    tags: ["Drive"],
    request: {
      body: {
        required: true,
        content: {
          "application/json": {
            schema: deleteDriveFileRequestSchema,
          },
        },
      },
    },
    responses: {
      204: {
        description: "Drive file deleted",
      },
      400: jsonErrorResponse("Bad Request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      409: jsonErrorResponse("Conflict"),
      422: jsonErrorResponse("Unprocessable Entity"),
      503: jsonErrorResponse("Service Unavailable"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const userContext = await requireAuthorizedUserContext(authContext);
    const body = c.req.valid("json");

    const { pathname } = body;

    const { scope, ownerId } = parseDriveFilePathname(
      pathname,
      userContext.userId,
    );

    await requireDriveFileAccess(authContext, scope, ownerId, {
      changes: [drivePathOf(pathname)],
    });

    if (!(await driveExists(pathname))) {
      throw notFound("Drive file not found");
    }

    const workspace = await resolveDriveTasksWorkspace({
      userContext,
      scope: scope === "user" ? "me" : "org",
      organizationId: scope === "organization" ? ownerId : undefined,
    });
    if (scope === "organization") {
      await requireNotCmoDriveFile(workspace.workspaceId, pathname);
    }

    await driveDel([pathname]);

    // Tombstone the catalog entry in the same request: a deleted document
    // must stop matching at once, not when a sweeper next runs.
    await tombstoneDriveUploadResource({
      workspaceId: workspace.workspaceId,
      scope,
      pathname,
    });

    return c.body(null, 204);
  });
}
