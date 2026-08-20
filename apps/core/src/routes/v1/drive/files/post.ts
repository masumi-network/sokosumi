import { createRoute } from "@hono/zod-openapi";
import {
  buildOrganizationDriveFilePathnameWithFolder,
  buildUserDriveFilePathnameWithFolder,
  clampDriveFileName,
  FILE_UPLOAD_MAX_SIZE_BYTES,
  isDriveFolderMarkerName,
  normalizeDriveFolderPath,
  resolveUserUploadContentType,
} from "@sokosumi/utils";
import { BlobNotFoundError, head, list } from "@vercel/blob";

import { getEnv } from "@/config/env";
import {
  requireOrganizationDriveFileUploadAccess,
  requireUserDriveFileUploadAccess,
} from "@/helpers/drive-file-access";
import {
  badRequest,
  conflict,
  payloadTooLarge,
  serviceUnavailable,
  unprocessableEntity,
} from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import { createBlobUploadGrant } from "@/lib/blob-upload-grant";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserContext } from "@/middleware/auth";
import {
  createDriveFileUploadSessionRequestSchema,
  driveFileUploadSessionSchema,
} from "@/schemas/drive-file.schema";

const route = createRoute({
  method: "post",
  path: "/",
  description: [
    "Mint a direct upload session for a drive file (personal or organization).",
    "Bytes go client → Vercel Blob (not through this API).",
    "Drive uses exact pathnames (addRandomSuffix: false).",
    "409 if target pathname already exists.",
    "",
    "Agent / REST:",
    "1. POST this endpoint with `filename`, `contentType`, `size`, and `scope` (+ `organizationId` if scope=org).",
    "2. PUT raw bytes to `uploadUrl` with `Content-Type` from `headers`.",
    "3. Done — file is immediately available via pathname.",
    "",
    `Max size: ${FILE_UPLOAD_MAX_SIZE_BYTES} bytes. MIME allowlist matches user uploads (including SVG for drive).`,
  ].join("\n"),
  tags: ["Drive"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: createDriveFileUploadSessionRequestSchema,
        },
      },
    },
  },
  responses: {
    201: jsonSuccessResponse(
      driveFileUploadSessionSchema,
      "Drive file upload session created",
    ),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    409: jsonErrorResponse("Conflict - target pathname already exists"),
    413: jsonErrorResponse("Payload Too Large"),
    422: jsonErrorResponse("Unprocessable Entity"),
    503: jsonErrorResponse("Service Unavailable"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const userContext = requireUserContext(authContext);

    const env = getEnv();
    const token = env.BLOB_READ_WRITE_TOKEN;
    if (!token) {
      throw serviceUnavailable("Blob storage is not configured");
    }

    const body = c.req.valid("json");

    if (body.size > FILE_UPLOAD_MAX_SIZE_BYTES) {
      throw payloadTooLarge(
        `File is too large. Maximum size is ${FILE_UPLOAD_MAX_SIZE_BYTES} bytes.`,
      );
    }

    const resolvedContentType = resolveUserUploadContentType(
      body.filename,
      body.contentType,
    );
    if (!resolvedContentType) {
      throw badRequest(
        `Unsupported content type. Allowed types match user uploads (e.g. application/pdf, image/png, image/svg+xml, text/plain).`,
      );
    }

    const displayName = clampDriveFileName(body.filename || "file");
    const folderPath = normalizeDriveFolderPath(body.folder ?? "");

    // Check if filename conflicts with reserved marker basename
    if (isDriveFolderMarkerName(displayName)) {
      throw badRequest(
        "File name conflicts with a reserved system name. Please choose a different name.",
      );
    }

    // ACL checks and owner resolution
    let pathname: string;

    if (body.scope === "me") {
      const ownerId = userContext.userId;
      await requireUserDriveFileUploadAccess(authContext, ownerId);
      pathname = buildUserDriveFilePathnameWithFolder(
        ownerId,
        folderPath,
        displayName,
      );
    } else if (body.scope === "org") {
      if (!body.organizationId) {
        throw unprocessableEntity("organizationId is required when scope=org");
      }
      const ownerId = body.organizationId;
      // Verifies membership
      await requireOrganizationDriveFileUploadAccess(authContext, ownerId);
      pathname = buildOrganizationDriveFilePathnameWithFolder(
        ownerId,
        folderPath,
        displayName,
      );
    } else {
      throw badRequest("Invalid scope. Must be 'me' or 'org'.");
    }

    // Check if target pathname already exists (file or folder)
    try {
      await head(pathname, { token });
      // If head succeeds, target file exists
      throw conflict("Target pathname already exists");
    } catch (error) {
      // If it's a not-found error, target doesn't exist (expected)
      if (error instanceof BlobNotFoundError) {
        // Target file doesn't exist, proceed
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

    // Check if a folder with the same name exists
    const folderPrefix = `${pathname}/`;
    const folderCheck = await list({
      prefix: folderPrefix,
      token,
      limit: 1,
    });
    if (folderCheck.blobs.length > 0) {
      throw conflict("A folder with that name already exists");
    }

    const grant = await createBlobUploadGrant({
      pathname,
      access: "public",
      contentType: resolvedContentType,
      maximumSizeInBytes: body.size,
      maxSizeBytes: FILE_UPLOAD_MAX_SIZE_BYTES,
      addRandomSuffix: false,
      token,
    });

    const session = {
      uploadUrl: grant.uploadUrl,
      pathname: grant.pathname,
      access: grant.access,
      method: "PUT" as const,
      headers: {
        "Content-Type": resolvedContentType,
      },
      expiresAt: grant.expiresAt,
      maxSizeBytes: FILE_UPLOAD_MAX_SIZE_BYTES,
      addRandomSuffix: false,
    };

    return created(c, driveFileUploadSessionSchema.parse(session));
  });
}
