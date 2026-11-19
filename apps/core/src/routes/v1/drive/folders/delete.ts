import { createRoute } from "@hono/zod-openapi";
import {
  buildOrganizationDriveFolderPrefix,
  buildUserDriveFolderPrefix,
  normalizeDriveFolderPath,
} from "@sokosumi/utils";

import { requireAuthorizedUserContext } from "@/helpers/coworker-user-context-binding";
import { requireDriveFileAccess } from "@/helpers/drive-file-access";
import { deleteDriveFiles } from "@/helpers/drive-file-delete";
import { resolveDriveTasksWorkspace } from "@/helpers/drive-tasks-workspace";
import { badRequest, notFound, unprocessableEntity } from "@/helpers/error";
import { jsonErrorResponse } from "@/helpers/openapi";
import { empty } from "@/helpers/response";
import { driveList } from "@/lib/drive-blob";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { deleteDriveFolderRequestSchema } from "@/schemas/drive-file.schema";
import { requireNotCmoDriveFile } from "@/services/cmo-cuso.service";
import { deleteDataRoomsUnder } from "@/services/data-room-paths.service";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "delete",
    path: "/delete",
    description: [
      "Delete a Drive folder and all its contents (blobs under that prefix).",
      "Personal: owner only. Organization: any member.",
      "Recursively deletes all blobs (files and nested folder markers).",
    ].join("\n"),
    tags: ["Drive"],
    request: {
      body: {
        required: true,
        content: {
          "application/json": {
            schema: deleteDriveFolderRequestSchema,
          },
        },
      },
    },
    responses: {
      204: {
        description: "Drive folder deleted",
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

    const folderPath = normalizeDriveFolderPath(body.folderPath);
    if (!folderPath) {
      throw badRequest("Folder path cannot be empty");
    }

    let prefix: string;
    let scope: "user" | "organization";
    let ownerId: string;

    if (body.scope === "me") {
      ownerId = userContext.userId;
      scope = "user";
      await requireDriveFileAccess(authContext, scope, ownerId);
      prefix = buildUserDriveFolderPrefix(ownerId, folderPath);
    } else if (body.scope === "org") {
      if (!body.organizationId) {
        throw unprocessableEntity("organizationId is required when scope=org");
      }
      ownerId = body.organizationId;
      scope = "organization";
      await requireDriveFileAccess(authContext, scope, ownerId, {
        changes: [folderPath],
      });
      prefix = buildOrganizationDriveFolderPrefix(ownerId, folderPath);
    } else {
      throw badRequest("Invalid scope. Must be 'me' or 'org'.");
    }

    // List and delete each page as we receive it (no unbounded accumulation).
    // After a deletion the listing starts over: a listing that spans both
    // stores pages by offset, and deleting shifts what an offset points at.
    let cursor: string | undefined;
    let foundAnyBlobs = false;
    const BATCH_SIZE = 100;

    // Resolve the workspace before deleting anything: resolving after the
    // blobs are gone means a failure here leaves them deleted and still
    // fully indexed.
    const workspace = await resolveDriveTasksWorkspace({
      userContext,
      scope: body.scope,
      organizationId: body.scope === "org" ? body.organizationId : undefined,
    });
    if (scope === "organization") {
      await requireNotCmoDriveFile(workspace.workspaceId, {
        startsWith: prefix,
      });
    }

    // Never twice: a listing that still shows something already deleted
    // moves on by cursor instead of starting over for ever.
    const seen = new Set<string>();
    for (;;) {
      const result = await driveList({ prefix, cursor, limit: 1000 });
      const blobs = result.blobs.filter((blob) => !seen.has(blob.pathname));

      if (blobs.length > 0) {
        foundAnyBlobs = true;
        for (const blob of blobs) seen.add(blob.pathname);

        for (let i = 0; i < blobs.length; i += BATCH_SIZE) {
          const batch = blobs.slice(i, i + BATCH_SIZE);
          // Tombstone in the same request, batch by batch, so a throw
          // part-way through leaves no deleted file indexed. Without this
          // the documents stayed fully indexed: deleted files kept matching
          // full-text search and kept returning content snippets.
          // Recoverably, and bound to what was observed: see
          // `deleteDriveFiles`.
          await deleteDriveFiles({
            workspaceId: workspace.workspaceId,
            scope,
            ownerId,
            pathnames: batch.map((blob) => blob.pathname),
          });
        }
        cursor = undefined;
        continue;
      }

      if (!result.hasMore || !result.cursor) break;
      cursor = result.cursor;
    }

    // 404 if no blobs exist under this prefix
    if (!foundAnyBlobs) {
      throw notFound("Folder not found");
    }

    await deleteDataRoomsUnder({ scope, ownerId, folderPath });

    return empty(c);
  });
}
