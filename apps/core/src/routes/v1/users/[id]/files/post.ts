import { createRoute, z } from "@hono/zod-openapi";
import {
  resolveUserUploadContentType,
  USER_UPLOAD_ALLOWED_CONTENT_TYPES,
} from "@sokosumi/utils";

import { LIMITS } from "@/config/constants";
import { getEnv } from "@/config/env";
import { serviceUnavailable } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import { createUserFileUploadSession } from "@/lib/blob";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { usersRoutePathUserIdSchema } from "@/routes/v1/users/user-path-access";
import {
  requireUserRouteContext,
  type UserRouteVariables,
} from "@/routes/v1/users/user-route-context";
import {
  createUserFileUploadRequestSchema,
  userFileUploadSessionSchema,
} from "@/schemas/user-file-upload.schema";

function normalizeContentType(contentType: string): string {
  return contentType.trim().split(";")[0]!.trim().toLowerCase();
}

function formatUnsupportedContentTypes(contentTypes: string[]): string {
  return contentTypes.map((contentType) => `"${contentType}"`).join(", ");
}

const pathParams = z.object({
  id: usersRoutePathUserIdSchema,
});

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

    const resolvedContentType = resolveUserUploadContentType(
      data.filename,
      data.contentType,
    );
    if (!resolvedContentType) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Unsupported content type: "${data.contentType}"`,
        path: ["contentType"],
      });
      return;
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

    const normalizedAllowedContentTypes = new Set(
      data.allowedContentTypes.map(normalizeContentType),
    );
    if (!normalizedAllowedContentTypes.has(resolvedContentType)) {
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
  path: "/files",
  description: [
    "Mint a direct upload session for a user file: path `me` for the session user,",
    "or a user id when the caller may access that user's data.",
    "Bytes go client → Vercel Blob (not through this API).",
    "",
    "Agent / REST:",
    "1. POST this endpoint with `filename`, `contentType`, and `size`.",
    "2. PUT the raw file bytes to `data.uploadUrl` with header `Content-Type` from `data.headers`",
    "   (or the resolved content type).",
    "3. Use the final public Blob URL from the PUT response (or product field that stores it).",
    "   No `@vercel/blob` SDK required.",
    "",
    "Reference: https://vercel.com/docs/vercel-blob/vercel-signed-urls",
  ].join("\n"),
  tags: ["Users"],
  request: {
    params: pathParams,
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
          uploadUrl:
            "https://store.public.blob.vercel-storage.com/users/user_123/document.pdf?vercel-blob-delegation=…",
          access: "public",
          method: "PUT",
          headers: { "Content-Type": "application/pdf" },
          pathname: "users/user_123/document_abc.pdf",
          addRandomSuffix: true,
          maxSizeBytes: LIMITS.USER_UPLOAD_MAX_SIZE_BYTES,
          expiresAt: "2026-02-16T12:15:00.000Z",
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
    404: jsonErrorResponse("Not Found"),
    422: jsonErrorResponse("Unprocessable Entity"),
    503: jsonErrorResponse("Service Unavailable"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth<UserRouteVariables>) {
  app.openapi(route, async (c) => {
    c.req.valid("param");
    const { resolvedUserId } = requireUserRouteContext(c.var.userRouteContext);

    const token = getEnv().BLOB_READ_WRITE_TOKEN;
    if (!token) {
      throw serviceUnavailable("Blob storage is not configured");
    }

    const uploadRequest = c.req.valid("json");
    const maxSizeBytes =
      uploadRequest.maxSizeBytes ?? LIMITS.USER_UPLOAD_MAX_SIZE_BYTES;
    const allowedContentTypes =
      uploadRequest.allowedContentTypes?.map(normalizeContentType);

    const resolvedContentType = resolveUserUploadContentType(
      uploadRequest.filename,
      uploadRequest.contentType,
    )!;

    const sessionInput: Parameters<typeof createUserFileUploadSession>[1] = {
      filename: uploadRequest.filename,
      contentType: resolvedContentType,
      size: uploadRequest.size,
      maxSizeBytes,
    };
    if (allowedContentTypes) {
      sessionInput.allowedContentTypes = allowedContentTypes;
    }

    const uploadSession = await createUserFileUploadSession(
      resolvedUserId,
      sessionInput,
      token,
    );

    return created(c, userFileUploadSessionSchema.parse(uploadSession));
  });
}
