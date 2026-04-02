import { createRoute } from "@hono/zod-openapi";

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

const requestSchema = createUserFileUploadRequestSchema.extend({
  size: createUserFileUploadRequestSchema.shape.size.max(
    LIMITS.USER_UPLOAD_MAX_SIZE_BYTES,
    `File exceeds maximum size of ${LIMITS.USER_UPLOAD_MAX_SIZE_BYTES} bytes`,
  ),
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
    const uploadSession = await createUserFileUploadSession(
      authContext.userId,
      {
        ...uploadRequest,
        maxSizeBytes: LIMITS.USER_UPLOAD_MAX_SIZE_BYTES,
      },
      token,
    );

    return created(c, userFileUploadSessionSchema.parse(uploadSession));
  });
}
