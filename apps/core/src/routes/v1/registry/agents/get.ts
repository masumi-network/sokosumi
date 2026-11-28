import { createRoute, z } from "@hono/zod-openapi";

import { masumiClients } from "@/clients/masumi";
import { badGateway } from "@/helpers/error";
import {
  jsonErrorResponse,
  jsonPaginatedSuccessResponse,
} from "@/helpers/openapi";
import {
  deduplicateQueryValues,
  preprocessMultiValueQueryInput,
} from "@/helpers/query-params";
import { ok } from "@/helpers/response";
import { recordCoreWarning } from "@/lib/evlog";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import {
  type CursorPaginationMeta,
  cursorPaginationMetaSchema,
} from "@/schemas/pagination.schema";
import {
  mapRegistryAgentForApi,
  REGISTRY_AGENT_STATUSES,
  registryAgentSchema,
} from "@/schemas/registry-agent.schema";

/** The registry rejects a page larger than this. */
const REGISTRY_MAX_PAGE_SIZE = 50;
/**
 * Extra rows asked for on top of `limit`: the registry repeats the cursor
 * entry as its first row, and one more row tells whether a next page exists.
 */
const REGISTRY_EXTRA_ROWS = 2;
const MAX_LIMIT = REGISTRY_MAX_PAGE_SIZE - REGISTRY_EXTRA_ROWS;
const DEFAULT_LIMIT = 20;

const querySchema = z.object({
  cursor: z
    .string()
    .min(1)
    .max(REGISTRY_MAX_PAGE_SIZE)
    .optional()
    .openapi({
      param: { name: "cursor", in: "query" },
      description: "`nextCursor` from the previous page.",
    }),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_LIMIT)
    .default(DEFAULT_LIMIT)
    .openapi({
      param: { name: "limit", in: "query" },
      description: `Number of agents to return (max ${MAX_LIMIT}).`,
      example: DEFAULT_LIMIT,
    }),
  status: z
    .preprocess(
      preprocessMultiValueQueryInput,
      z
        .array(z.enum(REGISTRY_AGENT_STATUSES))
        .min(1)
        .optional()
        .transform(deduplicateQueryValues),
    )
    .openapi({
      param: { name: "status", in: "query" },
      description:
        "Filter by registry status. Supports repeated values and comma-separated lists. Omit to return every status.",
      example: ["Online", "Offline"],
    }),
});

// The registry reports no total, so the page carries no `total` either.
const registryAgentsPaginationMetaSchema = cursorPaginationMetaSchema
  .omit({ total: true })
  .openapi("RegistryAgentsPaginationMetadata");

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/",
    operationId: "listRegistryAgents",
    description:
      "Lists every agent in the Masumi registry for this deployment's network (Mainnet on api.sokosumi.com), live from the registry and in every status, including agents Sokosumi does not list. Requires a user API key or a Coworker API key; session cookies and OAuth tokens get 403.",
    tags: ["Registry"],
    request: { query: querySchema },
    responses: {
      200: jsonPaginatedSuccessResponse(
        z.array(registryAgentSchema),
        "One page of registry agents, newest first",
        undefined,
        registryAgentsPaginationMetaSchema,
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("API key required"),
      422: jsonErrorResponse("Invalid query"),
      429: jsonErrorResponse("Registry read budget used up"),
      502: jsonErrorResponse("Masumi registry unavailable"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { cursor, limit, status } = c.req.valid("query");

    const result = await masumiClients(
      c.var.networkScope.network,
    ).registry.listEntries(
      {
        cursorId: cursor,
        limit: limit + REGISTRY_EXTRA_ROWS,
        // The registry returns only Online entries when no status is sent.
        status: status ?? [...REGISTRY_AGENT_STATUSES],
      },
      { signal: c.req.raw.signal },
    );
    if (result.isErr()) {
      recordCoreWarning(
        { operation: "registry_agents_list" },
        {
          message: "Masumi registry request failed",
          why: "The registry did not return a page of entries",
          cause: result.error,
        },
      );
      throw badGateway("Masumi registry unavailable");
    }

    const entries =
      cursor && result.value[0]?.id === cursor
        ? result.value.slice(1)
        : result.value;
    const page = entries.slice(0, limit);
    const hasMore = entries.length > limit;

    const paginationMeta = {
      cursor: cursor ?? null,
      limit,
      nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
    } as CursorPaginationMeta;

    return ok(
      c,
      z.array(registryAgentSchema).parse(page.map(mapRegistryAgentForApi)),
      paginationMeta,
    );
  });
}
