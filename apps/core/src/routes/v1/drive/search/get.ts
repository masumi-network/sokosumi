import { createRoute, z } from "@hono/zod-openapi";

import { resolveFileRequestContext } from "@/helpers/file-workspace";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { nudgeFileExtraction } from "@/lib/files/in-process-indexer";
import { SEARCH_PAGE_MAX } from "@/lib/files/search-session";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { driveFileScopeSchema } from "@/schemas/drive-file.schema";
import {
  fileExtractionStateSchema,
  fileSearchResponseSchema,
  fileSourceKindSchema,
} from "@/schemas/file-resource.schema";
import {
  backfillDriveStore,
  isDriveStoreBackfillPending,
} from "@/services/file-backfill.service";
import { searchFiles } from "@/services/file-search.service";

/** Plain text stays literal: there is no hidden query syntax to learn. */
const MAX_QUERY_CHARS = 1_000;

function csv(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return parts.length > 0 ? parts : undefined;
}

const querySchema = z.object({
  scope: driveFileScopeSchema,
  organizationId: z.string().optional(),
  q: z.string().max(MAX_QUERY_CHARS).optional(),
  categoryLabelIds: z.string().optional(),
  tagLabelIds: z.string().optional(),
  tagMatch: z.enum(["any", "all"]).optional(),
  projectIds: z.string().optional(),
  sourceKinds: z.string().optional(),
  typeFamilies: z.string().optional(),
  extractionStates: z.string().optional(),
  creatorUserIds: z.string().optional(),
  modifiedAfter: z.string().optional(),
  modifiedBefore: z.string().optional(),
  sortBy: z.enum(["relevance", "modified", "name"]).optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(SEARCH_PAGE_MAX).optional(),
});

const route = createRoute({
  method: "get",
  path: "/",
  description: [
    "Search files in the active workspace across filename, extracted text and confirmed metadata.",
    "",
    "Ordering: an exact normalized filename match always precedes everything else.",
    "With a query and relevance sort, the head of the window may be reordered by the",
    "evaluation model; any failure returns the whole deterministic order instead.",
    "An explicit name or date sort is never reordered.",
    "",
    "Paging walks positions in a ≤5 minute snapshot. `hasMore` means unconsumed",
    "positions in that snapshot, never additional matches in the corpus, and a later",
    "page can be short when entries changed. `truncated` is independent: it means a",
    "retrieval budget was reached, so more may match.",
  ].join("\n"),
  tags: ["Drive"],
  request: { query: querySchema },
  responses: {
    200: jsonSuccessResponse(fileSearchResponseSchema, "File search results"),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    422: jsonErrorResponse("Unprocessable Entity"),
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

    // Objects that predate this feature are adopted on visits, so they are
    // findable without a separate migration run. Bounded per visit and
    // resumed from a stored cursor, so a store larger than one listing page
    // finishes across several visits instead of stopping at its first 200.
    // It grants nothing: the Drive gate above already admitted this store.
    if (
      await isDriveStoreBackfillPending({
        workspaceId: context.workspaceId,
        scope: context.scope,
        ownerId: context.ownerId,
      })
    ) {
      await backfillDriveStore({
        workspaceId: context.workspaceId,
        scope: context.scope,
        ownerId: context.ownerId,
      });
      // Extraction only: a search is a read and must not buy label
      // evaluations. See `nudgeFileExtraction`.
      nudgeFileExtraction();
    }

    const text = query.q?.trim() ?? "";
    const sortBy = query.sortBy ?? (text.length > 0 ? "relevance" : "modified");

    const result = await searchFiles({
      workspaceId: context.workspaceId,
      actor: context.actor,
      query: text.length > 0 ? text : null,
      filters: {
        categoryLabelIds: csv(query.categoryLabelIds),
        tagLabelIds: csv(query.tagLabelIds),
        tagMatch: query.tagMatch ?? "any",
        projectIds: csv(query.projectIds),
        sourceKinds: csv(query.sourceKinds)?.filter(
          (kind): kind is z.infer<typeof fileSourceKindSchema> =>
            fileSourceKindSchema.safeParse(kind).success,
        ),
        typeFamilies: csv(query.typeFamilies),
        extractionStates: csv(query.extractionStates)?.filter(
          (state): state is z.infer<typeof fileExtractionStateSchema> =>
            fileExtractionStateSchema.safeParse(state).success,
        ),
        creatorUserIds: csv(query.creatorUserIds),
        modifiedAfter: query.modifiedAfter
          ? new Date(query.modifiedAfter)
          : undefined,
        modifiedBefore: query.modifiedBefore
          ? new Date(query.modifiedBefore)
          : undefined,
      },
      sortBy,
      sortOrder: query.sortOrder ?? (sortBy === "name" ? "asc" : "desc"),
      cursor: query.cursor ?? null,
      limit: query.limit ?? SEARCH_PAGE_MAX,
    });

    return ok(c, fileSearchResponseSchema.parse(result));
  });
}
