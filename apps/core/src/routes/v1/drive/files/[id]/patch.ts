import { createRoute } from "@hono/zod-openapi";
import {
  buildOrganizationDriveFilePathnameWithFolder,
  buildOrganizationDriveFilePrefix,
  buildUserDriveFilePathnameWithFolder,
  buildUserDriveFilePrefix,
  clampDriveFileName,
} from "@sokosumi/utils";
import { BlobNotFoundError } from "@vercel/blob";

import { requireAuthorizedUserContext } from "@/helpers/coworker-user-context-binding";
import {
  drivePathOf,
  requireDriveFileAccess,
} from "@/helpers/drive-file-access";
import { parseCacheControlMaxAge } from "@/helpers/drive-file-move";
import { parseDriveFilePathname } from "@/helpers/drive-file-pathname";
import { resolveDriveTasksWorkspace } from "@/helpers/drive-tasks-workspace";
import { conflict, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  driveExists,
  driveHasAny,
  driveHead,
  driveRename,
} from "@/lib/drive-blob";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import {
  driveFileSchema,
  renameDriveFileRequestSchema,
} from "@/schemas/drive-file.schema";
import { requireNotCmoDriveFile } from "@/services/cmo-cuso.service";
import { renameDriveUploadResource } from "@/services/file-catalog.service";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "patch",
    path: "/rename",
    description: [
      "Rename a drive file (copy to new pathname, then delete old).",
      "Personal: owner only.",
      "Organization: any member.",
      "409 if target pathname already exists.",
    ].join("\n"),
    tags: ["Drive"],
    request: {
      body: {
        required: true,
        content: {
          "application/json": {
            schema: renameDriveFileRequestSchema,
          },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(driveFileSchema, "Drive file renamed"),
      400: jsonErrorResponse("Bad Request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      409: jsonErrorResponse("Conflict - target pathname already exists"),
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

    const { oldPathname, newFilename } = body;

    const { scope, ownerId } = parseDriveFilePathname(
      oldPathname,
      userContext.userId,
    );

    await requireDriveFileAccess(authContext, scope, ownerId, {
      changes: [drivePathOf(oldPathname)],
    });

    const prefix =
      scope === "user"
        ? buildUserDriveFilePrefix(ownerId)
        : buildOrganizationDriveFilePrefix(ownerId);

    if (!oldPathname.startsWith(prefix)) {
      throw notFound("Source file not found");
    }

    const relativePathname = oldPathname.slice(prefix.length);
    const lastSlashIndex = relativePathname.lastIndexOf("/");
    const folderPath =
      lastSlashIndex >= 0 ? relativePathname.slice(0, lastSlashIndex) : "";

    const sanitizedName = clampDriveFileName(newFilename);
    const newPathname =
      scope === "user"
        ? buildUserDriveFilePathnameWithFolder(
            ownerId,
            folderPath,
            sanitizedName,
          )
        : buildOrganizationDriveFilePathnameWithFolder(
            ownerId,
            folderPath,
            sanitizedName,
          );

    const sourceMetadata = await driveHead(oldPathname);
    if (!sourceMetadata) throw notFound("Source file not found");
    if (await driveExists(newPathname)) {
      throw conflict("Target pathname already exists");
    }
    if (await driveHasAny(`${newPathname}/`)) {
      throw conflict("A folder with that name already exists");
    }

    const workspace = await resolveDriveTasksWorkspace({
      userContext,
      scope: scope === "user" ? "me" : "org",
      organizationId: scope === "organization" ? ownerId : undefined,
    });
    if (scope === "organization") {
      await requireNotCmoDriveFile(workspace.workspaceId, oldPathname);
    }

    let renamedBlob;
    try {
      renamedBlob = await driveRename(oldPathname, newPathname, {
        contentType: sourceMetadata.contentType,
        cacheControlMaxAge: parseCacheControlMaxAge(
          sourceMetadata.cacheControl,
        ),
      });
    } catch (error) {
      if (error instanceof BlobNotFoundError) {
        throw notFound("Source file not found");
      }
      if (
        error &&
        typeof error === "object" &&
        "message" in error &&
        typeof error.message === "string" &&
        error.message.toLowerCase().includes("already exists")
      ) {
        throw conflict("Target pathname already exists");
      }
      throw error;
    }

    const pathSegments = newPathname.split("/");
    const name = pathSegments[pathSegments.length - 1] || "unnamed";

    // The document is the same document. Only its name and object key move,
    // so nothing is re-extracted and no manual label is lost.
    await renameDriveUploadResource({
      workspaceId: workspace.workspaceId,
      scope,
      fromPathname: oldPathname,
      toPathname: renamedBlob.pathname,
      displayName: name,
    });

    return ok(
      c,
      driveFileSchema.parse({
        name,
        fileUrl: renamedBlob.url,
        pathname: renamedBlob.pathname,
        size: sourceMetadata.size,
        uploadedAt: sourceMetadata.uploadedAt.toISOString(),
        dataRoom: renamedBlob.access === "private",
      }),
    );
  });
}
