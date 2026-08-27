import { createRoute } from "@hono/zod-openapi";
import {
  buildOrganizationDriveFolderPrefix,
  buildUserDriveFolderPrefix,
  normalizeDriveFolderPath,
} from "@sokosumi/utils";
import { BlobNotFoundError, head, list, rename } from "@vercel/blob";
import pLimit from "p-limit";

import { getEnv } from "@/config/env";
import { requireDriveFileAccess } from "@/helpers/drive-file-access";
import { assertDriveFolderPathNotReserved } from "@/helpers/drive-folder-reserved-names";
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
import { renameDriveFolderRequestSchema } from "@/schemas/drive-file.schema";

const route = createRoute({
  method: "patch",
  path: "/rename",
  description: [
    "Rename a Drive folder (rename all blobs under the old prefix to new prefix).",
    "Personal: owner only. Organization: any member.",
    "409 if target folder path already exists.",
    "Renames all blobs recursively (files and nested folder markers).",
  ].join("\n"),
  tags: ["Drive"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: renameDriveFolderRequestSchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      renameDriveFolderRequestSchema,
      "Drive folder renamed",
    ),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    409: jsonErrorResponse("Conflict - target folder already exists"),
    422: jsonErrorResponse(
      "Unprocessable Entity - folder exceeds 500 descendant limit",
    ),
    503: jsonErrorResponse("Service Unavailable"),
  },
});

// Maximum descendants allowed for folder rename/move operations
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

    const oldFolderPath = normalizeDriveFolderPath(body.oldFolderPath);
    const newFolderPath = normalizeDriveFolderPath(body.newFolderPath);

    if (!oldFolderPath || !newFolderPath) {
      throw badRequest("Folder paths cannot be empty");
    }

    assertDriveFolderPathNotReserved(newFolderPath);

    let oldPrefix: string;
    let newPrefix: string;
    let scope: "user" | "organization";
    let ownerId: string;

    if (body.scope === "me") {
      ownerId = userContext.userId;
      scope = "user";
      await requireDriveFileAccess(authContext, scope, ownerId);
      oldPrefix = buildUserDriveFolderPrefix(ownerId, oldFolderPath);
      newPrefix = buildUserDriveFolderPrefix(ownerId, newFolderPath);
    } else if (body.scope === "org") {
      if (!body.organizationId) {
        throw unprocessableEntity("organizationId is required when scope=org");
      }
      ownerId = body.organizationId;
      scope = "organization";
      await requireDriveFileAccess(authContext, scope, ownerId);
      oldPrefix = buildOrganizationDriveFolderPrefix(ownerId, oldFolderPath);
      newPrefix = buildOrganizationDriveFolderPrefix(ownerId, newFolderPath);
    } else {
      throw badRequest("Invalid scope. Must be 'me' or 'org'.");
    }

    // Check if source folder exists (has at least one blob)
    const sourceCheck = await list({
      prefix: oldPrefix,
      token,
      limit: 1,
    });

    if (sourceCheck.blobs.length === 0) {
      throw notFound("Source folder not found");
    }

    // Check if target folder prefix already has blobs (conflict)
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

    // Reject renaming a folder into its own descendant
    if (
      newPrefix === oldPrefix ||
      newPrefix.startsWith(`${oldPrefix}`) // oldPrefix already ends with /
    ) {
      throw badRequest("Cannot rename a folder into its own descendant");
    }

    // Collect all pathnames under old prefix (capped at MAX+1 for detection)
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
            `Folder exceeds ${MAX_FOLDER_DESCENDANTS} descendant limit. Cannot rename.`,
          );
        }
        allPathnames.push(blob.pathname);
      }

      cursor = result.hasMore ? result.cursor : undefined;
    } while (cursor);

    // If exactly at MAX+1, we exceeded the limit
    if (allPathnames.length > MAX_FOLDER_DESCENDANTS) {
      throw unprocessableEntity(
        `Folder exceeds ${MAX_FOLDER_DESCENDANTS} descendant limit. Cannot rename.`,
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
            // Source already moved or deleted, skip (retry-safe)
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
