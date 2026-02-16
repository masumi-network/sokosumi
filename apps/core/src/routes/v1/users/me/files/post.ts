import { createRoute, z } from "@hono/zod-openapi";

import { LIMITS } from "@/config/constants";
import { getEnv } from "@/config/env";
import { badRequest, forbidden, serviceUnavailable } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import { uploadUserFile } from "@/lib/blob";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { userFileSchema } from "@/schemas/user-file.schema";

const fileFieldSchema = z.custom<File>(
  (value): value is File => value instanceof File,
  "File is required",
);

export const uploadUserFileRequestSchema = z.object({
  file: fileFieldSchema.openapi({
    type: "string",
    format: "binary",
    description: "File to upload",
  }),
});

const route = createRoute({
  method: "post",
  path: "/files",
  description: "Upload a file for the current user",
  tags: ["Users"],
  request: {
    body: {
      content: {
        "multipart/form-data": {
          schema: uploadUserFileRequestSchema,
        },
      },
    },
  },
  responses: {
    201: jsonSuccessResponse(userFileSchema, "File uploaded successfully", {
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
    503: jsonErrorResponse("Service Unavailable"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export function extractAndValidateFile(formData: { file?: unknown }): File {
  const fileValue = formData.file;

  if (!(fileValue instanceof File)) {
    throw badRequest("File is required");
  }

  if (fileValue.size <= 0) {
    throw badRequest("File cannot be empty");
  }

  if (fileValue.size > LIMITS.USER_UPLOAD_MAX_SIZE_BYTES) {
    throw badRequest(
      `File exceeds maximum size of ${LIMITS.USER_UPLOAD_MAX_SIZE_BYTES} bytes`,
    );
  }

  return fileValue;
}

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;

    if (authContext.coworkerId) {
      throw forbidden("Coworkers are not allowed to upload user files");
    }

    const token = getEnv().BLOB_READ_WRITE_TOKEN;
    if (!token) {
      throw serviceUnavailable("Blob storage is not configured");
    }

    const formData = c.req.valid("form");
    const file = extractAndValidateFile(formData);
    const uploadedFile = await uploadUserFile(authContext.userId, file, token);

    return created(c, userFileSchema.parse(uploadedFile));
  });
}
