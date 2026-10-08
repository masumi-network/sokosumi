import { createRoute } from "@hono/zod-openapi";
import {
  buildOrganizationDriveFolderPrefix,
  buildUserDriveFolderPrefix,
  isDriveFolderMarkerName,
  normalizeDriveFolderPath,
} from "@sokosumi/utils";
import { BlobNotFoundError, head, list, rename } from "@vercel/blob";
import pLimit from "p-limit";

import { getEnv } from "@/config/env";
import { requireAuthorizedUserContext } from "@/helpers/coworker-user-context-binding";
import { requireDriveFileAccess } from "@/helpers/drive-file-access";
import { parseDriveFilePathname } from "@/helpers/drive-file-pathname";
import {
  assertDriveFolderPathNotReserved,
  resolveMovedFolderPath,
} from "@/helpers/drive-folder-reserved-names";
import { resolveDriveTasksWorkspace } from "@/helpers/drive-tasks-workspace";
import {
  badRequest,
  conflict,
  notFound,
  serviceUnavailable,
  unprocessableEntity,
} from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { moveDriveItemRequestSchema } from "@/schemas/drive-file.schema";
import { reconcileDriveUploadMoves } from "@/services/file-catalog.service";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "patch",
    path: "/move",
    description: [
      "Move a Drive file or folder to a different folder path.",
      "Personal: owner only. Organization: any member.",
      "409 on name collision at target folder.",
      "For files: renames the file blob.",
      "For folders: renames all blobs under that prefix.",
    ].join("\n"),
    tags: ["Drive"],
    request: {
      body: {
        required: true,
        content: {
          "application/json": {
            schema: moveDriveItemRequestSchema,
          },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(
        moveDriveItemRequestSchema,
        "Drive item moved successfully",
      ),
      400: jsonErrorResponse("Bad Request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      409: jsonErrorResponse("Conflict - target already exists"),
      422: jsonErrorResponse(
        "Unprocessable Entity - folder exceeds 500 descendant limit",
      ),
      503: jsonErrorResponse("Service Unavailable"),
    },
  }),
);

// Maximum descendants allowed for folder move operations
const MAX_FOLDER_DESCENDANTS = 500;

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const userContext = await requireAuthorizedUserContext(authContext);
    const body = c.req.valid("json");

    /**
     * Tell the catalog what moved.
     *
     * Both branches below mutate Drive objects and neither used to say so,
     * which left every relocated document indexed under its old pathname.
     */
    // Resolved once, and deliberately resolved *before* the blob mutation
    // in each branch: resolving it afterwards means a failure here leaves
    // the objects moved and the catalog pointing at where they used to be.
    let resolvedWorkspaceId: string | null = null;
    const workspaceIdFor = async (scope: "user" | "organization") => {
      if (resolvedWorkspaceId !== null) return resolvedWorkspaceId;
      const workspace = await resolveDriveTasksWorkspace({
        userContext,
        scope: scope === "user" ? "me" : "org",
        organizationId:
          scope === "organization"
            ? (body.organizationId ?? undefined)
            : undefined,
      });
      resolvedWorkspaceId = workspace.workspaceId;
      return resolvedWorkspaceId;
    };

    const reconcileMoves = async (
      moves: readonly { fromPathname: string; toPathname: string }[],
      scope: "user" | "organization",
    ) => {
      if (moves.length === 0) return;
      await reconcileDriveUploadMoves({
        workspaceId: await workspaceIdFor(scope),
        scope,
        moves,
      });
    };

    const env = getEnv();
    const token = env.BLOB_READ_WRITE_TOKEN;
    if (!token) {
      throw serviceUnavailable("Blob storage is not configured");
    }

    const targetFolderPath = normalizeDriveFolderPath(body.targetFolderPath);

    if (body.itemType === "file") {
      const { scope, ownerId } = parseDriveFilePathname(
        body.sourcePathname,
        userContext.userId,
      );

      await requireDriveFileAccess(authContext, scope, ownerId);

      let sourceMetadata;
      try {
        sourceMetadata = await head(body.sourcePathname, { token });
      } catch (error) {
        if (error instanceof BlobNotFoundError) {
          throw notFound("Source file not found");
        }
        throw error;
      }

      const sourceSegments = body.sourcePathname.split("/");
      const filename = sourceSegments[sourceSegments.length - 1] || "unnamed";

      if (isDriveFolderMarkerName(filename)) {
        throw badRequest(
          "Cannot move the reserved folder marker file (__drive_folder__)",
        );
      }

      const targetPrefix =
        scope === "user"
          ? buildUserDriveFolderPrefix(ownerId, targetFolderPath)
          : buildOrganizationDriveFolderPrefix(ownerId, targetFolderPath);
      const targetPathname = `${targetPrefix}${filename}`;

      try {
        await head(targetPathname, { token });
        throw conflict("Target file already exists");
      } catch (error) {
        if (error instanceof BlobNotFoundError) {
        } else if (
          error &&
          typeof error === "object" &&
          "kind" in error &&
          error.kind === "conflict"
        ) {
          throw error;
        } else {
          throw error;
        }
      }

      const folderPrefix = `${targetPathname}/`;
      const folderCheck = await list({
        prefix: folderPrefix,
        token,
        limit: 1,
      });
      if (folderCheck.blobs.length > 0) {
        throw conflict("A folder with that name already exists");
      }

      // Before the mutation, so a workspace-resolution failure cannot
      // leave a moved object with a stale catalog entry.
      await workspaceIdFor(scope);

      const maxAge = parseCacheControlMaxAge(sourceMetadata.cacheControl);
      await rename(body.sourcePathname, targetPathname, {
        token,
        access: "public",
        addRandomSuffix: false,
        contentType: sourceMetadata.contentType,
        cacheControlMaxAge: maxAge,
      });

      // Follow the object in the catalog. Without this the entry kept
      // pointing at the vacated pathname, so a later upload there inherited
      // this document's manual tags.
      await reconcileMoves(
        [{ fromPathname: body.sourcePathname, toPathname: targetPathname }],
        scope,
      );

      return ok(c, body);
    }

    if (body.itemType === "folder") {
      if (!body.scope) {
        throw unprocessableEntity("scope is required for folder moves");
      }

      const sourceFolderPath = normalizeDriveFolderPath(body.sourcePathname);
      if (!sourceFolderPath) {
        throw badRequest("Source folder path cannot be empty");
      }

      const sourceFolderSegments = sourceFolderPath.split("/").filter((s) => s);
      const folderName =
        sourceFolderSegments[sourceFolderSegments.length - 1] || "";

      if (!folderName) {
        throw badRequest("Cannot determine folder name from source path");
      }

      const newFolderPath = resolveMovedFolderPath(
        targetFolderPath,
        folderName,
      );
      assertDriveFolderPathNotReserved(newFolderPath);

      let scope: "user" | "organization";
      let ownerId: string;
      let oldPrefix: string;
      let newPrefix: string;

      if (body.scope === "me") {
        ownerId = userContext.userId;
        scope = "user";
        await requireDriveFileAccess(authContext, scope, ownerId);
        oldPrefix = buildUserDriveFolderPrefix(ownerId, sourceFolderPath);
      } else if (body.scope === "org") {
        if (!body.organizationId) {
          throw unprocessableEntity(
            "organizationId is required when scope=org",
          );
        }
        ownerId = body.organizationId;
        scope = "organization";
        await requireDriveFileAccess(authContext, scope, ownerId);
        oldPrefix = buildOrganizationDriveFolderPrefix(
          ownerId,
          sourceFolderPath,
        );
      } else {
        throw badRequest("Invalid scope. Must be 'me' or 'org'.");
      }

      const sourceCheck = await list({
        prefix: oldPrefix,
        token,
        limit: 1,
      });

      if (sourceCheck.blobs.length === 0) {
        throw notFound("Source folder not found");
      }

      newPrefix =
        scope === "user"
          ? buildUserDriveFolderPrefix(ownerId, newFolderPath)
          : buildOrganizationDriveFolderPrefix(ownerId, newFolderPath);

      if (
        newPrefix === oldPrefix ||
        newPrefix.startsWith(`${oldPrefix}`) // oldPrefix already ends with /
      ) {
        throw badRequest("Cannot move a folder into its own descendant");
      }

      const targetCheck = await list({
        prefix: newPrefix,
        token,
        limit: 1,
      });

      if (targetCheck.blobs.length > 0) {
        throw conflict("Target folder already exists");
      }

      try {
        await head(newPrefix.slice(0, -1), { token });
        throw conflict("A file with that name already exists");
      } catch (error) {
        if (!(error instanceof BlobNotFoundError)) {
          throw error;
        }
      }

      // Collect all pathnames under source prefix (capped at MAX+1 for detection)
      const allPathnames: string[] = [];
      let cursor: string | undefined;

      do {
        const result = await list({
          prefix: oldPrefix,
          token,
          cursor,
          limit: 1000,
        });

        for (const blob of result.blobs) {
          if (allPathnames.length > MAX_FOLDER_DESCENDANTS) {
            throw unprocessableEntity(
              `Folder exceeds ${MAX_FOLDER_DESCENDANTS} descendant limit. Cannot move.`,
            );
          }
          allPathnames.push(blob.pathname);
        }

        cursor = result.hasMore ? result.cursor : undefined;
      } while (cursor);

      // If exactly at MAX+1, we exceeded the limit
      if (allPathnames.length > MAX_FOLDER_DESCENDANTS) {
        throw unprocessableEntity(
          `Folder exceeds ${MAX_FOLDER_DESCENDANTS} descendant limit. Cannot move.`,
        );
      }

      await workspaceIdFor(scope);

      // Bounded-concurrency head + rename (10 concurrent operations)
      const limit = pLimit(10);

      // Pairs that really moved, collected as they succeed so a partial
      // failure reconciles exactly what happened and nothing more.
      const moved: { fromPathname: string; toPathname: string }[] = [];

      const renameTasks = allPathnames.map((sourcePathname) =>
        limit(async () => {
          const relativePath = sourcePathname.slice(oldPrefix.length);
          const newPathname = `${newPrefix}${relativePath}`;

          // Skip if already at target (retry-safe). It still counts as
          // moved — see the note in the folder rename route: on a retry
          // these are precisely the files that moved first time round.
          try {
            const targetCheck = await head(newPathname, { token });
            if (targetCheck) {
              moved.push({
                fromPathname: sourcePathname,
                toPathname: newPathname,
              });
              return;
            }
          } catch (error) {
            if (!(error instanceof BlobNotFoundError)) {
              throw error;
            }
          }

          let sourceMetadata;
          try {
            sourceMetadata = await head(sourcePathname, { token });
          } catch (error) {
            if (error instanceof BlobNotFoundError) {
              // Source already moved or deleted, skip
              return;
            }
            throw error;
          }

          const maxAge = parseCacheControlMaxAge(sourceMetadata.cacheControl);
          try {
            await rename(sourcePathname, newPathname, {
              token,
              access: "public",
              addRandomSuffix: false,
              contentType: sourceMetadata.contentType,
              cacheControlMaxAge: maxAge,
            });
          } catch (error) {
            if (error instanceof BlobNotFoundError) {
              // Source was already moved/deleted (concurrent/retry), skip
              return;
            }
            throw error;
          }

          moved.push({ fromPathname: sourcePathname, toPathname: newPathname });
        }),
      );

      // `allSettled`: a partial failure must still reconcile what moved.
      // `Promise.all` rejected before the reconcile, leaving the catalog
      // pointing at pathnames the objects had already left.
      const outcomes = await Promise.allSettled(renameTasks);

      await reconcileMoves(moved, scope);

      const failed = outcomes.find((outcome) => outcome.status === "rejected");
      if (failed) throw failed.reason;

      return ok(c, body);
    }

    throw badRequest("Invalid itemType. Must be 'file' or 'folder'.");
  });
}

/**
 * Parse max-age from Cache-Control header.
 * Example: "public, max-age=31536000" → 31536000
 */
function parseCacheControlMaxAge(cacheControl: string): number | undefined {
  const match = /max-age=(\d+)/.exec(cacheControl);
  return match ? Number.parseInt(match[1], 10) : undefined;
}
