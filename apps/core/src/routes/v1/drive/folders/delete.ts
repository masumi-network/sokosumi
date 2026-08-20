import { createRoute } from "@hono/zod-openapi";
import {
  buildOrganizationDriveFolderPrefix,
  buildUserDriveFolderPrefix,
  normalizeDriveFolderPath,
} from "@sokosumi/utils";
import { del, list } from "@vercel/blob";

import { getEnv } from "@/config/env";
import { requireDriveFileAccess } from "@/helpers/drive-file-access";
import {
  badRequest,
  notFound,
  serviceUnavailable,
  unprocessableEntity,
} from "@/helpers/error";
import { jsonErrorResponse } from "@/helpers/openapi";
import { empty } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserContext } from "@/middleware/auth";
import { deleteDriveFolderRequestSchema } from "@/schemas/drive-file.schema";

const route = createRoute({
  method: "delete",
  path: "/delete",
  description: [
    "Delete a Drive folder and all its contents (blobs under that prefix).",
    "Personal: owner only. Organization: any member.",
    "Recursively deletes all blobs (files and nested folder markers).",
  ].join("\n"),
  tags: ["Drive"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: deleteDriveFolderRequestSchema,
        },
      },
    },
  },
  responses: {
    204: {
      description: "Drive folder deleted",
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

    const folderPath = normalizeDriveFolderPath(body.folderPath);
    if (!folderPath) {
      throw badRequest("Folder path cannot be empty");
    }

    let prefix: string;
    let scope: "user" | "organization";
    let ownerId: string;

    if (body.scope === "me") {
      ownerId = userContext.userId;
      scope = "user";
      await requireDriveFileAccess(authContext, scope, ownerId);
      prefix = buildUserDriveFolderPrefix(ownerId, folderPath);
    } else if (body.scope === "org") {
      if (!body.organizationId) {
        throw unprocessableEntity("organizationId is required when scope=org");
      }
      ownerId = body.organizationId;
      scope = "organization";
      await requireDriveFileAccess(authContext, scope, ownerId);
      prefix = buildOrganizationDriveFolderPrefix(ownerId, folderPath);
    } else {
      throw badRequest("Invalid scope. Must be 'me' or 'org'.");
    }

    // List all blobs under this prefix (including nested folders and marker)
    const allBlobs: string[] = [];
    let cursor: string | undefined;

    do {
      const result = await list({
        prefix,
        token,
        cursor,
        limit: 1000,
      });

      allBlobs.push(...result.blobs.map((b) => b.pathname));
      cursor = result.hasMore ? result.cursor : undefined;
    } while (cursor);

    // 404 if no blobs exist under this prefix
    if (allBlobs.length === 0) {
      throw notFound("Folder not found");
    }

    // Delete all blobs in bounded batches (100 blobs per batch)
    const BATCH_SIZE = 100;
    for (let i = 0; i < allBlobs.length; i += BATCH_SIZE) {
      const batch = allBlobs.slice(i, i + BATCH_SIZE);
      await del(batch, { token });
    }

    return empty(c);
  });
}
