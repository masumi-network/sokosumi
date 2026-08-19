import { createRoute } from "@hono/zod-openapi";
import {
  buildOrganizationDriveFolderPrefix,
  buildUserDriveFolderPrefix,
  normalizeDriveFolderPath,
} from "@sokosumi/utils";
import { BlobNotFoundError, head, list, rename } from "@vercel/blob";

import { getEnv } from "@/config/env";
import { requireDriveFileAccess } from "@/helpers/drive-file-access";
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
    422: jsonErrorResponse("Unprocessable Entity"),
    503: jsonErrorResponse("Service Unavailable"),
  },
});

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

    // List all blobs under old prefix
    const allBlobs: Array<{
      pathname: string;
      contentType: string;
      cacheControl: string;
    }> = [];
    let cursor: string | undefined;

    do {
      const result = await list({
        prefix: oldPrefix,
        token,
        cursor,
        limit: 1000,
      });

      for (const blob of result.blobs) {
        const metadata = await head(blob.pathname, { token });
        allBlobs.push({
          pathname: blob.pathname,
          contentType: metadata.contentType,
          cacheControl: metadata.cacheControl,
        });
      }

      cursor = result.hasMore ? result.cursor : undefined;
    } while (cursor);

    // Rename all blobs (replace old prefix with new prefix)
    for (const blob of allBlobs) {
      const relativePath = blob.pathname.slice(oldPrefix.length);
      const newPathname = `${newPrefix}${relativePath}`;

      const maxAge = parseCacheControlMaxAge(blob.cacheControl);

      try {
        await rename(blob.pathname, newPathname, {
          token,
          access: "public",
          addRandomSuffix: false,
          contentType: blob.contentType,
          cacheControlMaxAge: maxAge,
        });
      } catch (error) {
        // If rename fails partway through, some blobs may be in old location, some in new.
        // This is a known limitation of blob-only folder renames.
        if (error instanceof BlobNotFoundError) {
          throw notFound(
            `Source blob not found during rename: ${blob.pathname}`,
          );
        }
        throw error;
      }
    }

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
