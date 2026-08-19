import { createRoute, z } from "@hono/zod-openapi";
import {
  buildOrganizationDriveFolderPrefix,
  buildUserDriveFolderPrefix,
  isDriveFolderMarker,
  sanitizeDriveFileName,
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
import type { DriveItem } from "@/schemas/drive-file.schema";
import {
  driveFileScopeSchema,
  driveItemsSchema,
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
    folder: z
      .string()
      .optional()
      .openapi({
        param: { name: "folder", in: "query" },
        example: "Projects/2026",
        description:
          "Folder path relative to scope root (empty/omit for root, nested with slashes)",
      }),
    q: z
      .string()
      .optional()
      .openapi({
        param: { name: "q", in: "query" },
        example: "report",
        description:
          "Search query for filename filtering at current folder level (case-sensitive prefix match)",
      }),
  })
  .merge(cursorPaginationQuerySchema);

const route = createRoute({
  method: "get",
  path: "/",
  description: [
    "List drive items (folders and files) at the current folder level.",
    "Personal or organization, lexicographic order by pathname.",
    "Folders are next-level path segments with blobs or markers.",
    "Files are blobs at this level (excluding folder markers).",
  ].join("\n"),
  tags: ["Drive"],
  request: {
    query: querySchema,
  },
  responses: {
    200: jsonPaginatedSuccessResponse(driveItemsSchema, "Drive items"),
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

    const folderPath = query.folder?.trim() || "";

    if (query.scope === "me") {
      // Personal drive
      ownerId = userContext.userId;
      scope = "user";
      await requireDriveFileAccess(authContext, scope, ownerId);
      prefix = buildUserDriveFolderPrefix(ownerId, folderPath);
    } else if (query.scope === "org") {
      if (!query.organizationId) {
        throw unprocessableEntity("organizationId is required when scope=org");
      }
      // Org drive (verify membership)
      ownerId = query.organizationId;
      scope = "organization";
      await requireDriveFileAccess(authContext, scope, ownerId);
      prefix = buildOrganizationDriveFolderPrefix(ownerId, folderPath);
    } else {
      throw badRequest("Invalid scope. Must be 'me' or 'org'.");
    }

    // Parse pagination parameters
    const { cursor, take } = parseCursorPagination(query);

    // Apply search query to prefix if it looks like a filename prefix (at current folder)
    let searchPrefix = prefix;
    const searchQuery = query.q?.trim();
    if (searchQuery) {
      const sanitized = sanitizeDriveFileName(searchQuery);
      if (sanitized) {
        searchPrefix = `${prefix}${sanitized}`;
      }
    }

    // List blobs with pagination (single page).
    // We need to fetch more than requested to extract folders + files,
    // since Vercel Blob list() doesn't group by folder.
    // Use a larger limit to get enough data for folder extraction.
    const fetchLimit = Math.max(take * 10, 1000);
    const { blobs, hasMore } = await list({
      prefix: searchPrefix,
      token,
      cursor,
      limit: fetchLimit,
    });

    // Extract folders and files at this level
    const folders = new Map<string, boolean>();
    const files: DriveItem[] = [];

    for (const blob of blobs) {
      // Skip folder markers
      if (isDriveFolderMarker(blob.pathname)) {
        continue;
      }

      // Extract relative path from current prefix
      const relativePath = blob.pathname.slice(prefix.length);
      const segments = relativePath.split("/").filter((s) => s.length > 0);

      if (segments.length === 0) {
        // Skip empty
        continue;
      }

      if (segments.length === 1) {
        // File at this level
        const name = segments[0];
        files.push({
          type: "file",
          name,
          fileUrl: blob.url,
          pathname: blob.pathname,
          size: blob.size,
          uploadedAt: blob.uploadedAt.toISOString(),
        });
      } else {
        // Deeper path - extract folder at this level
        const folderName = segments[0];
        folders.set(folderName, true);
      }
    }

    // Build folder items
    const folderItems: DriveItem[] = Array.from(folders.keys())
      .sort()
      .map((name) => ({
        type: "folder" as const,
        name,
        path: name,
      }));

    // Combine folders + files (folders first, then files, both sorted)
    const allItems: DriveItem[] = [
      ...folderItems,
      ...files.sort((a, b) => a.name.localeCompare(b.name)),
    ];

    // Apply pagination to combined result
    const totalItems = allItems.length;
    const startIndex = cursor
      ? allItems.findIndex((item) => {
          if (item.type === "folder") {
            return item.name === cursor;
          }
          return item.name === cursor;
        }) + 1
      : 0;

    const paginatedItems = allItems.slice(startIndex, startIndex + take);
    const hasMoreItems =
      startIndex + take < totalItems || (hasMore && totalItems >= fetchLimit);

    // Next cursor is the last item's name
    const nextItemCursor =
      hasMoreItems && paginatedItems.length > 0
        ? paginatedItems[paginatedItems.length - 1].name
        : null;

    // Vercel Blob list() doesn't return total count.
    // Only include total when this is the complete result.
    const hasRealTotal = !hasMoreItems && !cursor;

    const paginationMeta = {
      cursor: cursor ?? null,
      limit: take,
      ...(hasRealTotal ? { total: totalItems } : {}),
      nextCursor: nextItemCursor,
    } as CursorPaginationMeta;

    return ok(c, driveItemsSchema.parse(paginatedItems), paginationMeta);
  });
}
