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

    // Build complete item list at this folder level:
    // - Fetch all blobs under the current prefix (not just 1000)
    // - Extract folders: unique first-level segments (from files or markers)
    // - Extract files: single-segment paths that are not markers
    // - Empty folders are represented by marker blobs

    const folders = new Map<string, boolean>();
    const files: DriveItem[] = [];
    let blobCursor: string | undefined;

    // Fetch all blobs at this prefix to build the complete item list
    do {
      const {
        blobs,
        hasMore,
        cursor: nextCursor,
      } = await list({
        prefix: searchPrefix,
        token,
        cursor: blobCursor,
        limit: 1000,
      });

      for (const blob of blobs) {
        // Extract relative path from current prefix
        const relativePath = blob.pathname.slice(prefix.length);
        const segments = relativePath.split("/").filter((s) => s.length > 0);

        if (segments.length === 0) {
          continue;
        }

        const isMarker = isDriveFolderMarker(blob.pathname);

        if (segments.length === 1) {
          // Single segment at this level
          if (isMarker) {
            // Marker basename directly at this level (shouldn't happen normally)
            continue;
          }
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
          // Deeper path (segments.length > 1)
          const folderName = segments[0];
          if (isMarker && segments.length === 2) {
            // Marker for an empty folder at this level
            // e.g., "Reports/__drive_folder__" -> folder "Reports"
            folders.set(folderName, true);
          } else if (!isMarker) {
            // File deeper down (or marker even deeper)
            folders.set(folderName, true);
          }
          // else: marker deeper than 2 segments - parent folder already captured
        }
      }

      if (!hasMore) {
        break;
      }

      blobCursor = nextCursor;
    } while (true);

    // Build folder items (sorted)
    const folderItems: DriveItem[] = Array.from(folders.keys())
      .sort()
      .map((name) => ({
        type: "folder" as const,
        name,
        path: name,
      }));

    // Sort files
    const sortedFiles = files.sort((a, b) => a.name.localeCompare(b.name));

    // Combine folders + files (folders first, then files)
    const allItems: DriveItem[] = [...folderItems, ...sortedFiles];

    // Apply cursor-based pagination if needed
    // The cursor from the client is an item name
    let startIndex = 0;
    if (cursor) {
      const cursorIndex = allItems.findIndex((item) => item.name === cursor);
      startIndex = cursorIndex >= 0 ? cursorIndex + 1 : 0;
    }

    const paginatedItems = allItems.slice(startIndex, startIndex + take);
    const hasMoreItems = startIndex + take < allItems.length;

    // Next cursor is the last item's name if there are more items
    const nextItemCursor =
      hasMoreItems && paginatedItems.length > 0
        ? paginatedItems[paginatedItems.length - 1].name
        : null;

    const paginationMeta = {
      cursor: cursor ?? null,
      limit: take,
      nextCursor: nextItemCursor,
    } as CursorPaginationMeta;

    return ok(c, driveItemsSchema.parse(paginatedItems), paginationMeta);
  });
}
