import { createRoute } from "@hono/zod-openapi";
import {
  clampDriveFileName,
  FILE_UPLOAD_MAX_SIZE_BYTES,
  resolveUserUploadContentType,
} from "@sokosumi/utils";

import { getEnv } from "@/config/env";
import {
  requireOrganizationDriveFileUploadAccess,
  requireUserDriveFileUploadAccess,
} from "@/helpers/drive-file-access";
import {
  badRequest,
  payloadTooLarge,
  serviceUnavailable,
} from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import { createDriveFileUploadSession } from "@/lib/blob";
import {
  DRIVE_FILE_UPLOAD_COMPLETED_PATH,
  resolveBlobUploadCallbackUrl,
} from "@/lib/blob-callback-url";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserContext } from "@/middleware/auth";
import {
  createDriveFileUploadSessionRequestSchema,
  driveFileUploadSessionSchema,
} from "@/schemas/drive-file.schema";

const route = createRoute({
  method: "post",
  path: "/files",
  description: [
    "Mint a direct upload session for a drive file (personal or organization).",
    "Bytes go client → Vercel Blob (not through this API).",
    "When the Blob PUT completes, Core auto-creates the DriveFile row via",
    "`POST /v1/webhooks/drive/files/uploaded` (Blob `onUploadCompleted` webhook).",
    "",
    "Agent / REST:",
    "1. POST this endpoint with `filename`, `contentType`, `size`, and `scope` (+ `organizationId` if scope=org).",
    "2. PUT raw bytes to `data.uploadUrl` with `Content-Type` from `data.headers`.",
    "3. Done — no register call. DriveFile appears via webhook; refresh the list if you need the row.",
    "",
    `Max size: ${FILE_UPLOAD_MAX_SIZE_BYTES} bytes. MIME allowlist matches user uploads (including SVG for drive).`,
    "Requires public Core URL for the completion callback (production / tunnel).",
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
    413: jsonErrorResponse("Payload Too Large"),
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
    if (!env.BLOB_WEBHOOK_PUBLIC_KEY) {
      throw serviceUnavailable(
        "Blob upload completion is not configured (BLOB_WEBHOOK_PUBLIC_KEY)",
      );
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

    // ACL checks and owner resolution
    let scope: "user" | "organization";
    let ownerId: string;

    if (body.scope === "me") {
      scope = "user";
      ownerId = userContext.userId;
      await requireUserDriveFileUploadAccess(authContext, ownerId);
    } else if (body.scope === "org") {
      if (!body.organizationId) {
        throw badRequest("organizationId is required when scope=org");
      }
      scope = "organization";
      ownerId = body.organizationId;
      // Verifies membership
      await requireOrganizationDriveFileUploadAccess(authContext, ownerId);
    } else {
      throw badRequest("Invalid scope. Must be 'me' or 'org'.");
    }

    const callbackUrl = resolveBlobUploadCallbackUrl(
      DRIVE_FILE_UPLOAD_COMPLETED_PATH,
    );

    const session = await createDriveFileUploadSession(
      scope,
      ownerId,
      {
        filename: displayName,
        contentType: resolvedContentType,
        size: body.size,
        maxSizeBytes: FILE_UPLOAD_MAX_SIZE_BYTES,
      },
      token,
      {
        uploadedByUserId: userContext.userId,
        callbackUrl,
      },
    );

    return created(c, driveFileUploadSessionSchema.parse(session));
  });
}
