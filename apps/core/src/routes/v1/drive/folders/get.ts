import { createRoute, z } from "@hono/zod-openapi";
import { DRIVE_OWNER_PREFIX_PATTERN } from "@sokosumi/utils";

import { resolveFileRequestContext } from "@/helpers/file-workspace";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { driveFileScopeSchema } from "@/schemas/drive-file.schema";

const querySchema = z.object({
  scope: driveFileScopeSchema,
  organizationId: z.string().optional(),
});

/**
 * How many distinct folders the facet will name.
 *
 * A picker is not a file system browser. Past a few hundred entries a list of
 * folders is not something a reader chooses from, and the search box above it
 * is the better tool — so this is a bound on the picker rather than a promise
 * about the corpus.
 */
const FOLDER_FACET_LIMIT = 500;

const route = createRoute({
  method: "get",
  path: "/",
  description: [
    "The folders files are filed under in this workspace, deepest paths and",
    "their ancestors, for the catalog's folder facet.",
    "",
    "Derived from the stored blob pathnames, so it lists folders that hold a",
    "file. An empty folder has no catalog entry and is not returned here.",
  ].join("\n"),
  tags: ["Drive"],
  request: { query: querySchema },
  responses: {
    200: jsonSuccessResponse(z.array(z.string()), "Folder paths"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const query = c.req.valid("query");

    const context = await resolveFileRequestContext({
      authContext,
      scope: query.scope,
      organizationId: query.organizationId,
    });

    /**
     * `sourceId` is the blob pathname. The first three segments are
     * `drive/<users|organizations>/<ownerId>`, which say nothing a reader
     * filed, and the last is the filename; what is left is the folder.
     *
     * Scoped to the workspace, like the vocabulary endpoint beside it. A
     * folder name is not evidence about a document's contents, and the
     * catalog's own metadata filters do not join the evidence scope either.
     */
    const rows = await prisma.$queryRaw<{ folder: string }[]>`
      SELECT DISTINCT substring(rel FROM '^(.*)/[^/]*$') AS folder
      FROM (
        SELECT regexp_replace(fr."sourceId", ${DRIVE_OWNER_PREFIX_PATTERN}, '')
          AS rel
        FROM file_resource fr
        WHERE fr."workspaceId" = ${context.workspaceId}::uuid
          AND fr."tombstonedAt" IS NULL
          AND fr."sourceId" ~ ${DRIVE_OWNER_PREFIX_PATTERN}
      ) stripped
      WHERE rel LIKE '%/%'
      ORDER BY folder
      LIMIT ${FOLDER_FACET_LIMIT}
    `;

    /**
     * Ancestors too. Only leaf folders hold files, so a workspace whose only
     * document is in `Media/Youtube/Shorts` would otherwise offer no way to
     * ask for everything under `Media` — and the filter matches by prefix, so
     * that narrowing already works.
     */
    const folders = new Set<string>();
    for (const row of rows) {
      const segments = row.folder.split("/");
      for (let depth = 1; depth <= segments.length; depth += 1) {
        folders.add(segments.slice(0, depth).join("/"));
      }
    }

    return ok(c, [...folders].sort());
  });
}
