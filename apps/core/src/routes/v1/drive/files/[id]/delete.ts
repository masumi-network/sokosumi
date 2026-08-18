import { createRoute } from "@hono/zod-openapi";
import { buildUserDriveFilePrefix } from "@sokosumi/utils";
import { del } from "@vercel/blob";

import { getEnv } from "@/config/env";
import { requireDriveFileAccess } from "@/helpers/drive-file-access";
import { badRequest, serviceUnavailable } from "@/helpers/error";
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

    // Determine scope and owner from pathname
    const userPrefix = buildUserDriveFilePrefix(userContext.userId);
    const isUserFile = pathname.startsWith(userPrefix);

    let scope: "user" | "organization";
    let ownerId: string;

    if (isUserFile) {
      // Personal drive
      scope = "user";
      ownerId = userContext.userId;
      await requireDriveFileAccess(authContext, scope, ownerId);
    } else {
      // Organization drive - extract orgId from pathname
      // pathname format: drive/organizations/{orgId}/{filename}
      const pathParts = pathname.split("/");
      if (
        pathParts.length < 4 ||
        pathParts[0] !== "drive" ||
        pathParts[1] !== "organizations"
      ) {
        throw badRequest("Invalid pathname format");
      }

      const orgId = pathParts[2];
      scope = "organization";
      ownerId = orgId;
      await requireDriveFileAccess(authContext, scope, ownerId);
    }

    // Delete the blob
    await del(pathname, { token });

    return c.body(null, 204);
  });
}
