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
    "Personal or organization, lexicographic order by name.",
    "Uses folded mode: one Blob page per request. Cursor is opaque (from Blob API).",
    "Folders are next-level path segments. Files are blobs at this level (no markers).",
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

    // Use folded mode: one Blob page = one GET response. No recursive drain.
    // Blob's folders array + current-level blobs. Paginate with Blob's cursor.
    const {
      blobs,
      folders,
      cursor: blobCursor,
      hasMore,
    } = await list({
      mode: "folded",
      prefix: searchPrefix,
      token,
      cursor: cursor || undefined,
      limit: take,
    });

    // Map folders array to folder items
    // folders are fully qualified paths; extract next segment relative to prefix
    const folderItems: DriveItem[] = [];
    for (const folderPath of folders) {
      // folderPath is like "drive/users/123/Reports/" or "drive/users/123/Reports"
      if (!folderPath.startsWith(prefix)) {
        continue;
      }
      const relativePath = folderPath.slice(prefix.length);
      // Remove trailing slash if present
      const normalized = relativePath.endsWith("/")
        ? relativePath.slice(0, -1)
        : relativePath;
      const segments = normalized.split("/").filter((s) => s.length > 0);
      if (segments.length > 0) {
        const folderName = segments[0];
        // Deduplicate
        if (!folderItems.some((f) => f.name === folderName)) {
          folderItems.push({
            type: "folder",
            name: folderName,
            path: folderName,
          });
        }
      }
    }

    // Map blobs to file items, excluding markers
    const fileItems: DriveItem[] = [];
    for (const blob of blobs) {
      // Skip folder markers (never emit as file)
      if (isDriveFolderMarker(blob.pathname)) {
        continue;
      }

      // Extract name from pathname
      const relativePath = blob.pathname.slice(prefix.length);
      const segments = relativePath.split("/").filter((s) => s.length > 0);
      if (segments.length > 0) {
        const name = segments[0];
        fileItems.push({
          type: "file",
          name,
          fileUrl: blob.url,
          pathname: blob.pathname,
          size: blob.size,
          uploadedAt: blob.uploadedAt.toISOString(),
        });
      }
    }

    // Sort folders and files
    folderItems.sort((a, b) => a.name.localeCompare(b.name));
    fileItems.sort((a, b) => a.name.localeCompare(b.name));

    // Combine folders + files (folders first)
    const allItems: DriveItem[] = [...folderItems, ...fileItems];

    const paginationMeta = {
      cursor: cursor ?? null,
      limit: take,
      nextCursor: hasMore ? blobCursor : null,
    } as CursorPaginationMeta;

    return ok(c, driveItemsSchema.parse(allItems), paginationMeta);
  });
}
