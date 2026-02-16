import { createRoute } from "@hono/zod-openapi";

import { getEnv } from "@/config/env";
import { forbidden, serviceUnavailable } from "@/helpers/error";
import { jsonContent, jsonErrorResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { listUserFiles } from "@/lib/blob";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  userFilesPaginatedResponseSchema,
  userFilesQuerySchema,
  userFilesSchema,
} from "@/schemas/user-file.schema";

const route = createRoute({
  method: "get",
  path: "/files",
  description: "Get uploaded files for the current user (paginated)",
  tags: ["Users"],
  request: {
    query: userFilesQuerySchema,
  },
  responses: {
    200: {
      description: "Retrieve user files",
      content: {
        "application/json": {
          ...jsonContent(userFilesPaginatedResponseSchema)[
            "application/json"
          ],
          example: {
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
              pagination: {
                cursor: null,
                limit: 10,
                hasMore: true,
                nextCursor: "cursor_abc123",
              },
            },
          },
        },
      },
    },
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    503: jsonErrorResponse("Service Unavailable"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const query = c.req.valid("query");

    if (authContext.coworkerId) {
      throw forbidden("Coworkers are not allowed to access user files");
    }

    const token = getEnv().BLOB_READ_WRITE_TOKEN;
    if (!token) {
      throw serviceUnavailable("Blob storage is not configured");
    }

    const result = await listUserFiles(authContext.userId, token, {
      cursor: query.cursor,
      limit: query.limit,
    });

    return ok(c, userFilesSchema.parse(result.files), {
      cursor: query.cursor ?? null,
      limit: query.limit,
      hasMore: result.hasMore,
      nextCursor: result.nextCursor,
    });
  });
}
