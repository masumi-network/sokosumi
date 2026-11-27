import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { LIMITS } from "@/config/constants";
import {
  jsonErrorResponse,
  jsonPaginatedSuccessResponse,
} from "@/helpers/openapi";
import { parseCursorPagination } from "@/helpers/pagination";
import {
  deduplicateQueryValues,
  preprocessMultiValueQueryInput,
} from "@/helpers/query-params";
import { ok } from "@/helpers/response";
import type { X402ListingDropReason } from "@/helpers/x402-agent-listing";
import {
  AGENT_LIST_KINDS,
  listAvailableAgents,
} from "@/lib/agent-catalog/list";
import { recordCoreWarning, tryUseLiveLogger } from "@/lib/evlog";
import { publicRequestNetworkScope } from "@/middleware/network-scope";
import { agentListSchema } from "@/schemas/agent.schema";
import {
  cursorPaginationMetaSchema,
  cursorPaginationQuerySchema,
} from "@/schemas/pagination.schema";

const agentsListPaginationMetaSchema = cursorPaginationMetaSchema.extend({
  total: z.number().int().min(0).openapi({
    example: 100,
    description:
      "Candidate-row count matching the query filters, before x402 fail-closed drops. Can exceed `data.length` and `limit`.",
  }),
});

function logX402ListingDrops(
  listedCount: number,
  dropsByReason: ReadonlyMap<X402ListingDropReason, number>,
  isUnfilteredFirstPage: boolean,
  hasMore: boolean,
): void {
  if (dropsByReason.size === 0) {
    return;
  }
  const x402Listing = { dropsByReason: Object.fromEntries(dropsByReason) };
  if (listedCount === 0 && isUnfilteredFirstPage && !hasMore) {
    recordCoreWarning(
      { operation: "agents_list" },
      {
        message: "Every x402 candidate agent was dropped as unpayable",
        why: "No candidate agent passed the x402 payability checks",
        fix: "Check the payment node's buy-side readiness and the agents' payment sources; dropsByReason names the check each agent failed.",
      },
      { x402Listing },
    );
    return;
  }
  tryUseLiveLogger()?.set({ x402Listing });
}

const agentsListQuerySchema = cursorPaginationQuerySchema
  .extend({
    category: z
      .preprocess(
        preprocessMultiValueQueryInput,
        z
          .array(z.string().min(1))
          .min(1)
          .optional()
          .transform(deduplicateQueryValues),
      )
      .openapi({
        param: { name: "category", in: "query" },
        description:
          "Filter Cardano-rail agents by category slug. Supports repeated values and comma-separated lists. The reserved value `uncategorized` matches agents without assigned categories. When multiple categories are provided, agents matching any category are returned. Rejected when `kind` is only `x402`.",
        example: "research,uncategorized",
      }),
    kind: z
      .preprocess(
        preprocessMultiValueQueryInput,
        z
          .array(z.enum(AGENT_LIST_KINDS))
          .min(1)
          .optional()
          .transform(deduplicateQueryValues),
      )
      .openapi({
        param: { name: "kind", in: "query" },
        description:
          "Rail to list. `cardano` is the MIP-003 hire catalog; `x402` is the EVM pay catalog. Omit to return both. Supports repeated values and comma-separated lists.",
        example: "cardano,x402",
      }),
  })
  .superRefine((value, ctx) => {
    const kinds = value.kind ?? [...AGENT_LIST_KINDS];
    const x402Only = kinds.length === 1 && kinds[0] === "x402";
    if (x402Only && value.category?.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["category"],
        message: "category cannot be combined with kind=x402",
      });
    }
  });

const route = createRoute({
  method: "get",
  path: "/",
  description:
    "List available agents (paginated). Items are discriminated by `kind`: `cardano` (MIP-003 hire) or `x402` (EVM pay). Omit `kind` to return both rails. Public. x402 filtering runs after candidate pagination, so a page can contain fewer items than `limit` while `nextCursor` still points at more. `meta.pagination.total` is that candidate-row count, not `data.length`.",
  tags: ["Agents"],
  security: [],
  request: {
    query: agentsListQuerySchema,
  },
  responses: {
    200: jsonPaginatedSuccessResponse(
      agentListSchema,
      "Retrieve all agents",
      {
        data: [],
        meta: {
          timestamp: "2025-01-15T12:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
          pagination: {
            cursor: null,
            limit: 20,
            total: 100,
            nextCursor: "cmaeygqwa000e8i0s9s7wif8i",
          },
        },
      },
      agentsListPaginationMetaSchema,
    ),
    403: jsonErrorResponse(
      "Forbidden. Only for Preprod (`X-Sokosumi-Network: preprod`, or a Preprod API key) or a key the header contradicts. Branch on `kind`: preprod_off (Preprod is switched off), preprod_access_required (an anonymous caller, a Coworker or Soko Bot key, or a person without Preprod access in the workspace) or api_key_network_mismatch (an API key of the other Network than the header names)",
    ),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

export default function mount(app: OpenAPIHono) {
  app.openapi(route, async (c) => {
    const queryParams = c.req.valid("query");
    const { cursor, take } = parseCursorPagination(queryParams);
    const { category: categorySlugs } = queryParams;
    const kinds = queryParams.kind ?? [...AGENT_LIST_KINDS];
    // Public router: the route makes its own scope, refused on first use
    // of Preprod without access.
    const scope = await publicRequestNetworkScope(c);
    const { items, pagination, listedX402Count, dropsByReason } =
      await listAvailableAgents(scope, {
        kinds,
        categorySlugs,
        cursor,
        take,
      });

    const isUnfilteredFirstPage =
      !cursor && take === LIMITS.DEFAULT_PAGINATION_LIMIT && !categorySlugs;
    if (kinds.includes("x402")) {
      logX402ListingDrops(
        listedX402Count,
        dropsByReason,
        isUnfilteredFirstPage,
        pagination.nextCursor !== null,
      );
    }

    return ok(c, agentListSchema.parse(items), pagination);
  });
}
