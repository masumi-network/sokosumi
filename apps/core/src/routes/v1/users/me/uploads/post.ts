import { createRoute, z } from "@hono/zod-openapi";

import { LIMITS } from "@/config/constants";
import { getEnv } from "@/config/env";
import { serviceUnavailable } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import { createUserFileUploadSession } from "@/lib/blob";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import {
  createUserFileUploadRequestSchema,
  userFileUploadSessionSchema,
} from "@/schemas/user-file-upload.schema";

const USER_UPLOAD_ALLOWED_CONTENT_TYPES = [
  "application/gzip",
  "application/json",
  "application/msword",
  "application/pdf",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/x-tar",
  "application/zip",
  "audio/m4a",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "audio/webm",
  "image/gif",
  "image/heic",
  "image/jpeg",
  "image/png",
  "image/svg+xml",
  "image/webp",
  "text/csv",
  "text/markdown",
  "text/plain",
  "video/mp4",
  "video/quicktime",
  "video/webm",
] as const;

function normalizeContentType(contentType: string): string {
  return contentType.trim().toLowerCase();
}

function formatUnsupportedContentTypes(contentTypes: string[]): string {
  return contentTypes.map((contentType) => `"${contentType}"`).join(", ");
}

const requestSchema = createUserFileUploadRequestSchema
  .extend({
    size: createUserFileUploadRequestSchema.shape.size.max(
      LIMITS.USER_UPLOAD_MAX_SIZE_BYTES,
      `File exceeds maximum size of ${LIMITS.USER_UPLOAD_MAX_SIZE_BYTES} bytes`,
    ),
  })
  .superRefine((data, ctx) => {
    if (
      data.maxSizeBytes !== undefined &&
      data.maxSizeBytes > LIMITS.USER_UPLOAD_MAX_SIZE_BYTES
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `maxSizeBytes cannot exceed ${LIMITS.USER_UPLOAD_MAX_SIZE_BYTES} bytes`,
        path: ["maxSizeBytes"],
      });
    }

    if (data.maxSizeBytes !== undefined && data.size > data.maxSizeBytes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `File exceeds maximum size of ${data.maxSizeBytes} bytes`,
        path: ["size"],
      });
    }

    if (!data.allowedContentTypes || data.allowedContentTypes.length === 0) {
      return;
    }

    const unsupportedContentTypes = data.allowedContentTypes.filter(
      (contentType) =>
        !USER_UPLOAD_ALLOWED_CONTENT_TYPES.includes(
          normalizeContentType(
            contentType,
          ) as (typeof USER_UPLOAD_ALLOWED_CONTENT_TYPES)[number],
        ),
    );
    if (unsupportedContentTypes.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Unsupported content types requested: ${formatUnsupportedContentTypes(unsupportedContentTypes)}`,
        path: ["allowedContentTypes"],
      });
      return;
    }

    const normalizedContentType = normalizeContentType(data.contentType);
    const normalizedAllowedContentTypes = new Set(
      data.allowedContentTypes.map(normalizeContentType),
    );
    if (!normalizedAllowedContentTypes.has(normalizedContentType)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "contentType must be included in allowedContentTypes when a custom allowlist is provided",
        path: ["contentType"],
      });
    }
  });

const route = createRoute({
  method: "post",
  path: "/uploads",
  description: "Create a direct upload session for a user file",
  tags: ["Users"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: requestSchema,
        },
      },
    },
  },
  responses: {
    201: jsonSuccessResponse(
      userFileUploadSessionSchema,
      "User file upload session created successfully",
      {
        data: {
          clientToken: "vercel_blob_client_token",
          access: "public",
          pathname: "users/user_123/document_abc.pdf",
          addRandomSuffix: true,
          maxSizeBytes: LIMITS.USER_UPLOAD_MAX_SIZE_BYTES,
        },
        meta: {
          timestamp: "2026-02-16T12:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    422: jsonErrorResponse("Unprocessable Entity"),
    503: jsonErrorResponse("Service Unavailable"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const authContext = requireUserAuthContext(c.var.authContext);

    const token = getEnv().BLOB_READ_WRITE_TOKEN;
    if (!token) {
      throw serviceUnavailable("Blob storage is not configured");
    }

    const uploadRequest = c.req.valid("json");
    const maxSizeBytes =
      uploadRequest.maxSizeBytes ?? LIMITS.USER_UPLOAD_MAX_SIZE_BYTES;
    const allowedContentTypes =
      uploadRequest.allowedContentTypes?.map(normalizeContentType);

    const sessionInput: Parameters<typeof createUserFileUploadSession>[1] = {
      filename: uploadRequest.filename,
      contentType: normalizeContentType(uploadRequest.contentType),
      size: uploadRequest.size,
      maxSizeBytes,
    };
    if (allowedContentTypes) {
      sessionInput.allowedContentTypes = allowedContentTypes;
    }

    const uploadSession = await createUserFileUploadSession(
      authContext.userId,
      sessionInput,
      token,
    );

    return created(c, userFileUploadSessionSchema.parse(uploadSession));
  });
}
