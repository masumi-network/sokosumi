import { createRoute } from "@hono/zod-openapi";
import { BlobNotFoundError, del, head } from "@vercel/blob";

import { getEnv } from "@/config/env";
import { requireDriveFileAccess } from "@/helpers/drive-file-access";
import { parseDriveFilePathname } from "@/helpers/drive-file-pathname";
import { notFound, serviceUnavailable } from "@/helpers/error";
import { jsonErrorResponse } from "@/helpers/openapi";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserContext } from "@/middleware/auth";
import { deleteDriveFileRequestSchema } from "@/schemas/drive-file.schema";

const route = createRoute({
  method: "delete",
  path: "/delete",
  description: [
    "Delete a drive file by pathname.",
    "Personal: owner only.",
    "Organization: any member.",
  ].join("\n"),
  tags: ["Drive"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: deleteDriveFileRequestSchema,
        },
      },
    },
  },
  responses: {
    204: {
      description: "Drive file deleted",
    },
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    422: jsonErrorResponse("Unprocessable Entity"),
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

    const { pathname } = body;

    // Parse pathname to determine scope and owner
    const { scope, ownerId } = parseDriveFilePathname(
      pathname,
      userContext.userId,
    );

    // Verify access
    await requireDriveFileAccess(authContext, scope, ownerId);

    // Check if file exists
    try {
      await head(pathname, { token });
    } catch (error) {
      if (error instanceof BlobNotFoundError) {
        throw notFound("Drive file not found");
      }
      throw error;
    }

    // Delete the blob
    await del(pathname, { token });

    return c.body(null, 204);
  });
}
