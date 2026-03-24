import { createRoute, z } from "@hono/zod-openapi";
import { bodyLimit } from "hono/body-limit";

import { LIMITS } from "@/config/constants";
import { getEnv } from "@/config/env";
import { payloadTooLarge, serviceUnavailable } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import { uploadUserFile } from "@/lib/blob";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { blobFileSchema } from "@/schemas/blob-file.schema";

const MULTIPART_FORM_OVERHEAD_BYTES = 256 * 1024;
const MAX_UPLOAD_REQUEST_SIZE_BYTES =
  LIMITS.USER_UPLOAD_MAX_SIZE_BYTES + MULTIPART_FORM_OVERHEAD_BYTES;

const uploadUserFileFormSchema = z.object({
  file: z
    .file({ error: "File is required" })
    .min(1, "File cannot be empty")
    .max(
      LIMITS.USER_UPLOAD_MAX_SIZE_BYTES,
      `File exceeds maximum size of ${LIMITS.USER_UPLOAD_MAX_SIZE_BYTES} bytes`,
    )
    .openapi({
      type: "string",
      format: "binary",
    }),
});

const route = createRoute({
  method: "post",
  path: "/files",
  description: "Upload a file for the current user",
  tags: ["Users"],
  middleware: bodyLimit({
    maxSize: MAX_UPLOAD_REQUEST_SIZE_BYTES,
    onError: () => {
      throw payloadTooLarge("Request body exceeds upload size limit");
    },
  }),
  request: {
    body: {
      required: true,
      content: {
        "multipart/form-data": {
          schema: uploadUserFileFormSchema,
        },
      },
    },
  },
  responses: {
    201: jsonSuccessResponse(blobFileSchema, "File uploaded successfully", {
      data: {
        publicUrl:
          "https://store.public.blob.vercel-storage.com/users/user_123/document_abc.pdf",
        metadata: {
          pathname: "users/user_123/document_abc.pdf",
          downloadUrl:
            "https://store.public.blob.vercel-storage.com/document_abc.pdf?download=1",
          size: 2048000,
          uploadedAt: "2026-02-16T12:00:00.000Z",
          etag: '"a1b2c3d4"',
        },
      },
      meta: {
        timestamp: "2026-02-16T12:00:00.000Z",
        requestId: "550e8400-e29b-41d4-a716-446655440000",
      },
    }),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    413: jsonErrorResponse("Payload Too Large"),
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

    const { file } = c.req.valid("form");
    const uploadedFile = await uploadUserFile(authContext.userId, file, token);

    return created(c, blobFileSchema.parse(uploadedFile));
  });
}
