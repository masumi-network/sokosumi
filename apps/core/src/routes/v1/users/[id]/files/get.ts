import { createRoute, z } from "@hono/zod-openapi";

import { getEnv } from "@/config/env";
import { serviceUnavailable } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { listUserUploads } from "@/lib/blob";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { usersRoutePathUserIdSchema } from "@/routes/v1/users/user-path-access";
import {
  requireUserRouteContext,
  type UserRouteVariables,
} from "@/routes/v1/users/user-route-context";
import { blobFilesSchema } from "@/schemas/blob-file.schema";

const params = z.object({
  id: usersRoutePathUserIdSchema,
});

const route = createRoute({
  method: "get",
  path: "/files",
  description:
    "List user files in Blob storage: path `me` for the session user, or a user id when the caller may access that user's data.",
  tags: ["Users"],
  request: { params },
  responses: {
    200: jsonSuccessResponse(blobFilesSchema, "Retrieve user files", {
      data: [
        {
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
      ],
      meta: {
        timestamp: "2026-02-16T12:00:00.000Z",
        requestId: "550e8400-e29b-41d4-a716-446655440000",
      },
    }),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
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

    const files = await listUserUploads(resolvedUserId, token);

    return ok(c, blobFilesSchema.parse(files));
  });
}
