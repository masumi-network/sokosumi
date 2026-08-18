import { createRoute } from "@hono/zod-openapi";
import {
  buildOrganizationDriveFilePathname,
  buildUserDriveFilePathname,
  buildUserDriveFilePrefix,
  clampDriveFileName,
} from "@sokosumi/utils";
import { copy, del, list } from "@vercel/blob";

import { getEnv } from "@/config/env";
import { requireDriveFileAccess } from "@/helpers/drive-file-access";
import { badRequest, conflict, serviceUnavailable } from "@/helpers/error";
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

    // Determine scope and owner from pathname
    const userPrefix = buildUserDriveFilePrefix(userContext.userId);
    const isUserFile = oldPathname.startsWith(userPrefix);

    let scope: "user" | "organization";
    let ownerId: string;
    let newPathname: string;

    if (isUserFile) {
      // Personal drive
      scope = "user";
      ownerId = userContext.userId;
      await requireDriveFileAccess(authContext, scope, ownerId);

      const sanitizedName = clampDriveFileName(newFilename);
      newPathname = buildUserDriveFilePathname(ownerId, sanitizedName);
    } else {
      // Organization drive - extract orgId from pathname
      // pathname format: drive/organizations/{orgId}/{filename}
      const pathParts = oldPathname.split("/");
      if (
        pathParts.length < 4 ||
        pathParts[0] !== "drive" ||
        pathParts[1] !== "organizations"
      ) {
        throw badRequest("Invalid pathname format");
      }

      const orgId = pathParts[2];
      scope = "organization";
      ownerId = orgId;
      await requireDriveFileAccess(authContext, scope, ownerId);

      const sanitizedName = clampDriveFileName(newFilename);
      newPathname = buildOrganizationDriveFilePathname(ownerId, sanitizedName);
    }

    // Check if target already exists (copy will fail if it does)
    // We rely on Blob's behavior: copy fails if target exists

    try {
      // Copy to new pathname
      const copiedBlob = await copy(oldPathname, newPathname, {
        token,
        access: "public",
        addRandomSuffix: false,
      });

      // Delete old pathname
      await del(oldPathname, { token });

      // Get blob metadata via list to get size and uploadedAt
      const { blobs } = await list({
        prefix: copiedBlob.pathname,
        token,
        limit: 1,
      });

      const blobMetadata = blobs[0];
      if (!blobMetadata) {
        throw new Error("Failed to retrieve blob metadata after copy");
      }

      // Extract filename from new pathname
      const pathSegments = copiedBlob.pathname.split("/");
      const name = pathSegments[pathSegments.length - 1] || "unnamed";

      return ok(
        c,
        driveFileSchema.parse({
          name,
          fileUrl: copiedBlob.url,
          pathname: copiedBlob.pathname,
          size: blobMetadata.size,
          uploadedAt: blobMetadata.uploadedAt.toISOString(),
        }),
      );
    } catch (error) {
      // Check if it's a conflict (target already exists)
      if (error instanceof Error && error.message.includes("already exists")) {
        throw conflict("Target pathname already exists");
      }
      throw error;
    }
  });
}
