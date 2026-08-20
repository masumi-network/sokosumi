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
import { requireDriveFileAccess } from "@/helpers/drive-file-access";
import { parseDriveFilePathname } from "@/helpers/drive-file-pathname";
import {
  badRequest,
  conflict,
  notFound,
  serviceUnavailable,
  unprocessableEntity,
} from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserContext } from "@/middleware/auth";
import { moveDriveItemRequestSchema } from "@/schemas/drive-file.schema";

const route = createRoute({
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
});

// Maximum descendants allowed for folder move operations
const MAX_FOLDER_DESCENDANTS = 500;

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const userContext = requireUserContext(authContext);
    const body = c.req.valid("json");

    const env = getEnv();
    const token = env.BLOB_READ_WRITE_TOKEN;
    if (!token) {
      throw serviceUnavailable("Blob storage is not configured");
    }

    const targetFolderPath = normalizeDriveFolderPath(body.targetFolderPath);

    if (body.itemType === "file") {
      // Move file
      const { scope, ownerId } = parseDriveFilePathname(
        body.sourcePathname,
        userContext.userId,
      );

      await requireDriveFileAccess(authContext, scope, ownerId);

      // Get source metadata
      let sourceMetadata;
      try {
        sourceMetadata = await head(body.sourcePathname, { token });
      } catch (error) {
        if (error instanceof BlobNotFoundError) {
          throw notFound("Source file not found");
        }
        throw error;
      }

      // Extract filename from source
      const sourceSegments = body.sourcePathname.split("/");
      const filename = sourceSegments[sourceSegments.length - 1] || "unnamed";

      // Reject moving the reserved marker file
      if (isDriveFolderMarkerName(filename)) {
        throw badRequest(
          "Cannot move the reserved folder marker file (__drive_folder__)",
        );
      }

      // Build target pathname
      const targetPrefix =
        scope === "user"
          ? buildUserDriveFolderPrefix(ownerId, targetFolderPath)
          : buildOrganizationDriveFolderPrefix(ownerId, targetFolderPath);
      const targetPathname = `${targetPrefix}${filename}`;

      // Check if target exists (file or folder)
      try {
        await head(targetPathname, { token });
        throw conflict("Target file already exists");
      } catch (error) {
        if (error instanceof BlobNotFoundError) {
          // Target file doesn't exist, proceed
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

      // Check if a folder with the same name exists
      const folderPrefix = `${targetPathname}/`;
      const folderCheck = await list({
        prefix: folderPrefix,
        token,
        limit: 1,
      });
      if (folderCheck.blobs.length > 0) {
        throw conflict("A folder with that name already exists");
      }

      // Rename file
      const maxAge = parseCacheControlMaxAge(sourceMetadata.cacheControl);
      await rename(body.sourcePathname, targetPathname, {
        token,
        access: "public",
        addRandomSuffix: false,
        contentType: sourceMetadata.contentType,
        cacheControlMaxAge: maxAge,
      });

      return ok(c, body);
    }

    if (body.itemType === "folder") {
      // Move folder - requires explicit scope + organizationId
      if (!body.scope) {
        throw unprocessableEntity("scope is required for folder moves");
      }

      const sourceFolderPath = normalizeDriveFolderPath(body.sourcePathname);
      if (!sourceFolderPath) {
        throw badRequest("Source folder path cannot be empty");
      }

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

      // Check if source folder exists
      const sourceCheck = await list({
        prefix: oldPrefix,
        token,
        limit: 1,
      });

      if (sourceCheck.blobs.length === 0) {
        throw notFound("Source folder not found");
      }

      // Extract folder name from source
      const sourceFolderSegments = sourceFolderPath.split("/").filter((s) => s);
      const folderName =
        sourceFolderSegments[sourceFolderSegments.length - 1] || "";

      if (!folderName) {
        throw badRequest("Cannot determine folder name from source path");
      }

      const newFolderPath = targetFolderPath
        ? `${targetFolderPath}/${folderName}`
        : folderName;
      newPrefix =
        scope === "user"
          ? buildUserDriveFolderPrefix(ownerId, newFolderPath)
          : buildOrganizationDriveFolderPrefix(ownerId, newFolderPath);

      // Reject moving a folder into its own descendant
      if (
        newPrefix === oldPrefix ||
        newPrefix.startsWith(`${oldPrefix}`) // oldPrefix already ends with /
      ) {
        throw badRequest("Cannot move a folder into its own descendant");
      }

      // Check if target exists
      const targetCheck = await list({
        prefix: newPrefix,
        token,
        limit: 1,
      });

      if (targetCheck.blobs.length > 0) {
        throw conflict("Target folder already exists");
      }

      // Check if a file with that name exists (newPrefix ends with /, check without it)
      try {
        await head(newPrefix.slice(0, -1), { token });
        throw conflict("A file with that name already exists");
      } catch (error) {
        if (!(error instanceof BlobNotFoundError)) {
          throw error;
        }
        // File doesn't exist, proceed
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
          // Collect up to MAX+1 to detect over-limit
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

      // Bounded-concurrency head + rename (10 concurrent operations)
      const limit = pLimit(10);

      const renameTasks = allPathnames.map((sourcePathname) =>
        limit(async () => {
          const relativePath = sourcePathname.slice(oldPrefix.length);
          const newPathname = `${newPrefix}${relativePath}`;

          // Skip if already at target (retry-safe)
          try {
            const targetCheck = await head(newPathname, { token });
            if (targetCheck) {
              // Already exists at target, skip
              return;
            }
          } catch (error) {
            if (!(error instanceof BlobNotFoundError)) {
              throw error;
            }
            // Target doesn't exist, proceed with rename
          }

          // Get source metadata
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

          // Rename
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
        }),
      );

      await Promise.all(renameTasks);

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
