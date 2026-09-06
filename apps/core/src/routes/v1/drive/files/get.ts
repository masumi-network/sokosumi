import { createRoute, z } from "@hono/zod-openapi";
import {
  buildOrganizationDriveFolderPrefix,
  buildUserDriveFolderPrefix,
  isDriveFolderMarker,
  sanitizeDriveFileName,
} from "@sokosumi/utils";
import { list } from "@vercel/blob";

import { getEnv } from "@/config/env";
import { requireAuthorizedUserContext } from "@/helpers/coworker-user-context-binding";
import {
  paginateSortedDriveBrowseItems,
  sortDriveBrowseItems,
} from "@/helpers/drive-browse-sort";
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
import type { DriveItem } from "@/schemas/drive-file.schema";
import {
  driveFileScopeSchema,
  driveItemsSchema,
} from "@/schemas/drive-file.schema";
import {
  driveListSortQueryFields,
  resolveDriveListSort,
} from "@/schemas/drive-list-sort.schema";
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
    ...driveListSortQueryFields,
  })
  .merge(cursorPaginationQuerySchema);

const route = createRoute({
  method: "get",
  path: "/",
  description: [
    "List drive items (folders and files) at the current folder level.",
    "Personal or organization scope.",
    "Omit sortBy/sortOrder for today's default: folders then files, each name ascending (Blob page-local).",
    "With sortBy/sortOrder (name|date|type, asc|desc): folders stay a leading bucket;",
    "files sort by display name, uploadedAt, or mime/extension type family.",
    "Explicit sort drains the current folder on the server and paginates with a signed cursor",
    "so order stays correct across pages (no client full drain).",
    "Search (q) still filters the current folder; sort applies to the filtered set.",
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

function mapBlobPageToItems(input: {
  prefix: string;
  folders: string[];
  blobs: Array<{
    pathname: string;
    url: string;
    size: number;
    uploadedAt: Date;
  }>;
}): { folderItems: DriveItem[]; fileItems: DriveItem[] } {
  const folderItems: DriveItem[] = [];
  for (const folderPath of input.folders) {
    if (!folderPath.startsWith(input.prefix)) {
      continue;
    }
    const relativePath = folderPath.slice(input.prefix.length);
    const normalized = relativePath.endsWith("/")
      ? relativePath.slice(0, -1)
      : relativePath;
    const segments = normalized.split("/").filter((s) => s.length > 0);
    if (segments.length > 0) {
      const folderName = segments[0];
      if (!folderItems.some((f) => f.name === folderName)) {
        folderItems.push({
          type: "folder",
          name: folderName,
          path: folderName,
        });
      }
    }
  }

  const fileItems: DriveItem[] = [];
  for (const blob of input.blobs) {
    if (isDriveFolderMarker(blob.pathname)) {
      continue;
    }

    const relativePath = blob.pathname.slice(input.prefix.length);
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

  return { folderItems, fileItems };
}

const MAX_BLOB_LIST_PAGES = 100;

async function listAllFolderItems(input: {
  token: string;
  searchPrefix: string;
  prefix: string;
}): Promise<DriveItem[]> {
  const folderByName = new Map<string, DriveItem>();
  const fileByPathname = new Map<string, DriveItem>();
  let blobCursor: string | undefined;
  let hasMore = true;
  let pageCount = 0;

  while (hasMore) {
    pageCount += 1;
    if (pageCount > MAX_BLOB_LIST_PAGES) {
      throw unprocessableEntity(
        "This folder is too large to sort globally. Omit sortBy to use page-local ordering.",
      );
    }

    const page = await list({
      mode: "folded",
      prefix: input.searchPrefix,
      token: input.token,
      cursor: blobCursor,
      limit: 1000,
    });

    const { folderItems, fileItems } = mapBlobPageToItems({
      prefix: input.prefix,
      folders: page.folders,
      blobs: page.blobs,
    });

    for (const folder of folderItems) {
      folderByName.set(folder.name, folder);
    }
    for (const file of fileItems) {
      if (file.type === "file") {
        fileByPathname.set(file.pathname, file);
      }
    }

    if (!page.hasMore) {
      hasMore = false;
      break;
    }

    const nextCursor = page.cursor ?? undefined;
    if (!nextCursor || nextCursor === blobCursor) {
      throw unprocessableEntity(
        "Blob storage returned an incomplete page while sorting this folder. Omit sortBy to use page-local ordering.",
      );
    }

    blobCursor = nextCursor;
  }

  return [...folderByName.values(), ...fileByPathname.values()];
}

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const userContext = await requireAuthorizedUserContext(authContext);
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
      ownerId = userContext.userId;
      scope = "user";
      await requireDriveFileAccess(authContext, scope, ownerId);
      prefix = buildUserDriveFolderPrefix(ownerId, folderPath);
    } else if (query.scope === "org") {
      if (!query.organizationId) {
        throw unprocessableEntity("organizationId is required when scope=org");
      }
      ownerId = query.organizationId;
      scope = "organization";
      await requireDriveFileAccess(authContext, scope, ownerId);
      prefix = buildOrganizationDriveFolderPrefix(ownerId, folderPath);
    } else {
      throw badRequest("Invalid scope. Must be 'me' or 'org'.");
    }

    const { cursor, take } = parseCursorPagination(query);
    const sort = resolveDriveListSort(query, "name");

    let searchPrefix = prefix;
    const searchQuery = query.q?.trim() ?? "";
    if (searchQuery) {
      const sanitized = sanitizeDriveFileName(searchQuery);
      if (sanitized) {
        searchPrefix = `${prefix}${sanitized}`;
      }
    }

    // Explicit sort: drain current folder, sort globally, signed cursor pages.
    if (sort) {
      const allItems = await listAllFolderItems({
        token,
        searchPrefix,
        prefix,
      });
      const sorted = sortDriveBrowseItems(allItems, sort);
      const { page, nextCursor } = paginateSortedDriveBrowseItems({
        items: sorted,
        sort,
        limit: take,
        cursor,
        cursorSecret: env.BETTER_AUTH_SECRET,
        cursorBinding: {
          prefix,
          searchQuery,
          sortBy: sort.sortBy,
          sortOrder: sort.sortOrder,
        },
      });

      const paginationMeta = {
        cursor: cursor ?? null,
        limit: take,
        nextCursor,
      } as CursorPaginationMeta;

      return ok(c, driveItemsSchema.parse(page), paginationMeta);
    }

    // Omit sort: today's Blob page-local name sort (folders then files).
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

    const { folderItems, fileItems } = mapBlobPageToItems({
      prefix,
      folders,
      blobs,
    });

    folderItems.sort((a, b) => a.name.localeCompare(b.name));
    fileItems.sort((a, b) => a.name.localeCompare(b.name));
    const allItems: DriveItem[] = [...folderItems, ...fileItems];

    const paginationMeta = {
      cursor: cursor ?? null,
      limit: take,
      nextCursor: hasMore ? blobCursor : null,
    } as CursorPaginationMeta;

    return ok(c, driveItemsSchema.parse(allItems), paginationMeta);
  });
}
