import { createRoute, z } from "@hono/zod-openapi";
import {
  buildOrganizationDriveFilePrefix,
  buildUserDriveFilePrefix,
} from "@sokosumi/utils";
import { list } from "@vercel/blob";

import { getEnv } from "@/config/env";
import { requireDriveFileAccess } from "@/helpers/drive-file-access";
import {
  badRequest,
  serviceUnavailable,
  unprocessableEntity,
} from "@/helpers/error";
import {
  jsonErrorResponse,
  jsonPaginatedSuccessResponse,
} from "@/helpers/openapi";
import { parseCursorPagination } from "@/helpers/pagination";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserContext } from "@/middleware/auth";
import type { DriveFile } from "@/schemas/drive-file.schema";
import {
  driveFileScopeSchema,
  driveFilesSchema,
} from "@/schemas/drive-file.schema";
import {
  type CursorPaginationMeta,
  cursorPaginationQuerySchema,
} from "@/schemas/pagination.schema";

const querySchema = z
  .object({
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
  })
  .merge(cursorPaginationQuerySchema);

const route = createRoute({
  method: "get",
  path: "/",
  description:
    "List drive files (personal or organization, lexicographic order by pathname)",
  tags: ["Drive"],
  request: {
    query: querySchema,
  },
  responses: {
    200: jsonPaginatedSuccessResponse(driveFilesSchema, "Drive files"),
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
        throw unprocessableEntity("organizationId is required when scope=org");
      }
      // Org drive (verify membership)
      ownerId = query.organizationId;
      scope = "organization";
      await requireDriveFileAccess(authContext, scope, ownerId);
      prefix = buildOrganizationDriveFilePrefix(ownerId);
    } else {
      throw badRequest("Invalid scope. Must be 'me' or 'org'.");
    }

    // Parse pagination parameters
    const { cursor, take } = parseCursorPagination(query);

    // List blobs with pagination (single page)
    const {
      blobs,
      cursor: nextCursor,
      hasMore,
    } = await list({
      prefix,
      token,
      cursor,
      limit: take,
    });

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

    // Blob list() returns lexicographic pathname order; keep that order for valid cursor pagination.
    // Do not sort by uploadedAt — that breaks cursor across pages.

    // Vercel Blob list() doesn't return total count.
    // Only include total when this is the complete result (!hasMore && no incoming cursor).
    // Otherwise omit it — draining all pages is forbidden. Never send 0 or fake values.
    const hasRealTotal = !hasMore && !cursor;

    // Create pagination metadata using Vercel Blob's cursor
    // Type assertion: ok() expects CursorPaginationMeta but we conditionally omit total
    const paginationMeta = {
      cursor: cursor ?? null,
      limit: take,
      ...(hasRealTotal ? { total: blobs.length } : {}),
      nextCursor: hasMore ? (nextCursor ?? null) : null,
    } as CursorPaginationMeta;

    return ok(c, driveFilesSchema.parse(apiFiles), paginationMeta);
  });
}
