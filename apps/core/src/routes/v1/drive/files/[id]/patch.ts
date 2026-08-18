import { createRoute } from "@hono/zod-openapi";
import {
  buildOrganizationDriveFilePathname,
  buildUserDriveFilePathname,
  clampDriveFileName,
} from "@sokosumi/utils";
import { BlobNotFoundError, head, rename } from "@vercel/blob";

import { getEnv } from "@/config/env";
import { requireDriveFileAccess } from "@/helpers/drive-file-access";
import { parseDriveFilePathname } from "@/helpers/drive-file-pathname";
import { conflict, notFound, serviceUnavailable } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserContext } from "@/middleware/auth";
import {
  driveFileSchema,
  renameDriveFileRequestSchema,
} from "@/schemas/drive-file.schema";

const route = createRoute({
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

    const { oldPathname, newFilename } = body;

    // Parse pathname to determine scope and owner
    const { scope, ownerId } = parseDriveFilePathname(
      oldPathname,
      userContext.userId,
    );

    // Verify access
    await requireDriveFileAccess(authContext, scope, ownerId);

    // Build new pathname
    const sanitizedName = clampDriveFileName(newFilename);
    const newPathname =
      scope === "user"
        ? buildUserDriveFilePathname(ownerId, sanitizedName)
        : buildOrganizationDriveFilePathname(ownerId, sanitizedName);

    // Get source blob metadata for preservation
    let sourceMetadata;
    try {
      sourceMetadata = await head(oldPathname, { token });
    } catch (error) {
      if (error instanceof BlobNotFoundError) {
        throw notFound("Source file not found");
      }
      throw error;
    }

    // Check if target already exists
    try {
      await head(newPathname, { token });
      // If head succeeds, target exists
      throw conflict("Target pathname already exists");
    } catch (error) {
      // If it's a not-found error, target doesn't exist (expected)
      if (error instanceof BlobNotFoundError) {
        // Target doesn't exist, proceed with rename
      } else if (
        error &&
        typeof error === "object" &&
        "kind" in error &&
        error.kind === "conflict"
      ) {
        // Re-throw our own conflict errors
        throw error;
      } else {
        // Unexpected error from head
        throw error;
      }
    }

    // Rename (copy + delete atomically)
    let renamedBlob;
    try {
      renamedBlob = await rename(oldPathname, newPathname, {
        token,
        access: "public",
        addRandomSuffix: false,
        // Preserve metadata from source
        contentType: sourceMetadata.contentType,
        cacheControlMaxAge: parseCacheControlMaxAge(
          sourceMetadata.cacheControl,
        ),
      });
    } catch (error) {
      // Map Blob errors to HTTP responses
      if (error instanceof BlobNotFoundError) {
        throw notFound("Source file not found");
      }
      // Check for conflict/already-exists errors from rename
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

    // Extract filename from new pathname
    const pathSegments = newPathname.split("/");
    const name = pathSegments[pathSegments.length - 1] || "unnamed";

    return ok(
      c,
      driveFileSchema.parse({
        name,
        fileUrl: renamedBlob.url,
        pathname: renamedBlob.pathname,
        size: sourceMetadata.size,
        uploadedAt: sourceMetadata.uploadedAt.toISOString(),
      }),
    );
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
