import { createRoute, z } from "@hono/zod-openapi";
import {
  buildOrganizationDriveFilePrefix,
  buildUserDriveFilePrefix,
} from "@sokosumi/utils";
import { list } from "@vercel/blob";

import { getEnv } from "@/config/env";
import { requireDriveFileAccess } from "@/helpers/drive-file-access";
import { badRequest, serviceUnavailable } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserContext } from "@/middleware/auth";
import type { DriveFile } from "@/schemas/drive-file.schema";
import {
  driveFileScopeSchema,
  driveFilesSchema,
} from "@/schemas/drive-file.schema";

const querySchema = z.object({
  scope: driveFileScopeSchema.openapi({
    param: { name: "scope", in: "query" },
    description: "Drive scope: 'me' for personal, 'org' for organization",
  }),
  organizationId: z
    .string()
    .optional()
    .openapi({
      param: { name: "organizationId", in: "query" },
      example: "org_123",
      description: "Organization ID (required when scope=org)",
    }),
});

const route = createRoute({
  method: "get",
  path: "/",
  description: "List drive files (personal or organization, newest first)",
  tags: ["Drive"],
  request: {
    query: querySchema,
  },
  responses: {
    200: jsonSuccessResponse(driveFilesSchema, "Drive files"),
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
    const query = c.req.valid("query");

    const env = getEnv();
    const token = env.BLOB_READ_WRITE_TOKEN;
    if (!token) {
      throw serviceUnavailable("Blob storage is not configured");
    }

    let prefix: string;
    let scope: "user" | "organization";
    let ownerId: string;

    if (query.scope === "me") {
      // Personal drive
      ownerId = userContext.userId;
      scope = "user";
      await requireDriveFileAccess(authContext, scope, ownerId);
      prefix = buildUserDriveFilePrefix(ownerId);
    } else if (query.scope === "org") {
      if (!query.organizationId) {
        throw badRequest("organizationId is required when scope=org");
      }
      // Org drive (verify membership)
      ownerId = query.organizationId;
      scope = "organization";
      await requireDriveFileAccess(authContext, scope, ownerId);
      prefix = buildOrganizationDriveFilePrefix(ownerId);
    } else {
      throw badRequest("Invalid scope. Must be 'me' or 'org'.");
    }

    // List all blobs with the prefix (paginate through all results)
    const blobs: Awaited<ReturnType<typeof list>>["blobs"] = [];
    for (let cursor: string | undefined; ; ) {
      const {
        blobs: pageBlobs,
        hasMore,
        cursor: nextCursor,
      } = await list({
        prefix,
        token,
        cursor,
      });
      blobs.push(...pageBlobs);

      if (!hasMore) {
        break;
      }

      if (!nextCursor) {
        throw new Error(
          "Blob list pagination is invalid: hasMore=true without cursor",
        );
      }

      cursor = nextCursor;
    }

    // Map to API schema
    const apiFiles: DriveFile[] = blobs.map((blob) => {
      // Extract filename from pathname (last segment after /)
      const pathSegments = blob.pathname.split("/");
      const name = pathSegments[pathSegments.length - 1] || "unnamed";

      return {
        name,
        fileUrl: blob.url,
        pathname: blob.pathname,
        size: blob.size,
        uploadedAt: blob.uploadedAt.toISOString(),
      };
    });

    // Sort by uploadedAt descending (newest first)
    apiFiles.sort(
      (a, b) =>
        new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime(),
    );

    return ok(c, driveFilesSchema.parse(apiFiles));
  });
}
