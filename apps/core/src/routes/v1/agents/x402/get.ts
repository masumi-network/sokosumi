import { createRoute } from "@hono/zod-openapi";
import { AgentEntryType, agentOrderBy } from "@sokosumi/database";

import { LIMITS } from "@/config/constants";
import { getEnv } from "@/config/env";
import {
  AGENT_PRICING_READ_TRANSACTION_OPTIONS,
  getAgentDescription,
  getAgentImage,
  getAgentName,
} from "@/helpers/agent";
import { forbidden } from "@/helpers/error";
import {
  jsonErrorResponse,
  jsonPaginatedSuccessResponse,
} from "@/helpers/openapi";
import {
  createPaginationMeta,
  parseCursorPagination,
} from "@/helpers/pagination";
import { ok } from "@/helpers/response";
import {
  buildX402AgentPricingListing,
  type X402ListingDropReason,
} from "@/helpers/x402-agent-listing";
import {
  getX402AgentCatalogWhere,
  getX402ReadySources,
  hasValidX402DiscoveryUrl,
} from "@/helpers/x402-readiness";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { isCoworkerAgentContext, isUserAuthContext } from "@/middleware/auth";
import { cursorPaginationQuerySchema } from "@/schemas/pagination.schema";
import { type X402Agent, x402AgentsSchema } from "@/schemas/x402-agent.schema";

/**
 * One line per request summarising which gates hid agents, never one per
 * agent. Warns only when the UNFILTERED FIRST PAGE came back empty, candidates
 * were queried, and no later raw page exists — that is the state an operator
 * reports as "the listing is broken"; partial drops are routine and stay at
 * debug.
 *
 * Both other inputs to that condition are client-supplied. `cursor` lets a
 * coworker aim a page at an agent it already knows is unpayable, and `limit`
 * narrows the page until a single such agent IS the page — either one makes
 * `listedCount === 0` hold on a perfectly healthy deployment, one warn per
 * request, loopable. Restricting the warn to the default-limit, cursorless
 * page leaves the client choosing neither which agents appear nor how many,
 * so warn volume tracks the deployment's health rather than its traffic.
 * Every demoted case still reports the per-reason tally at debug.
 */
function logX402ListingDrops(
  listedCount: number,
  dropsByReason: ReadonlyMap<X402ListingDropReason, number>,
  isUnfilteredFirstPage: boolean,
  hasMore: boolean,
): void {
  if (dropsByReason.size === 0) {
    return;
  }
  const summary = JSON.stringify(Object.fromEntries(dropsByReason));
  if (listedCount === 0 && isUnfilteredFirstPage && !hasMore) {
    console.warn(
      `[agents/x402] every candidate agent was dropped as unpayable: ${summary}`,
    );
    return;
  }
  // "non-payable", not "dropped": the tally also carries
  // `unpriced_dynamic_preview`, whose agents are LISTED as previews — calling
  // those dropped would send an operator hunting for a hidden agent that is
  // being served. The warn above keeps "dropped" because the non-drop tally
  // implies a listed agent, so it can never appear there.
  console.debug(`[agents/x402] non-payable agents by reason: ${summary}`);
}

const route = withGlobalHeaderParameters(
  createRoute({
    method: "get",
    path: "/x402",
    description:
      "List x402-capable X402/Bazaar and OpenAPI agents (paginated). Authenticated users and direct coworker agents receive fixed-price entries plus dynamic-price entries whose runtime 402 quote can be paid with a mandatory maxCredits ceiling. Dynamic entries remain visible with `isPayable: false` when no registered network has a priced buy-side-ready asset. Fixed entries fail closed unless every advertised x402 source is priced, on an allowed network, and buy-side ready. Filtering runs AFTER candidate pagination, so a page can contain fewer items than `limit` while `nextCursor` still points at more; follow it until null. `total` counts candidate X402 entries, not payable ones.",
    tags: ["Agents"],
    request: {
      query: cursorPaginationQuerySchema,
    },
    responses: {
      200: jsonPaginatedSuccessResponse(
        x402AgentsSchema,
        "Retrieve payable x402 agents and dynamic previews",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      422: jsonErrorResponse("Unprocessable Entity"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    // Any authenticated user actor may read the listing: the shared auth
    // context intentionally covers sessions, Better Auth API keys, and OAuth
    // tokens. Paying a 402 remains coworker-only on the task payment endpoint.
    // A delegated coworker is still rejected here because its actor remains
    // `coworker`, but it is no longer acting as itself.
    if (
      !isUserAuthContext(authContext) &&
      !isCoworkerAgentContext(authContext)
    ) {
      throw forbidden("User or coworker agent authentication required");
    }

    const { cursor, take, skip } = parseCursorPagination(c.req.valid("query"));

    // Fixed entries need buy-side readiness. Dynamic entries remain
    // discoverable as explicitly non-payable previews when no source is ready.
    // creditCost is non-throwing on purpose (NOT getCreditCostsOrThrow): an
    // empty credit_cost table must not 500 the listing. With nothing priced,
    // every agent fails the pricing gate and drops out, so the fail-closed
    // listing is simply empty.
    const [readySources, creditCosts] = await Promise.all([
      getX402ReadySources(prisma),
      prisma.creditCost.findMany(),
    ]);
    const network = getEnv().NETWORK;

    const where = getX402AgentCatalogWhere(network);
    const takePlusOne = take + 1;
    // One snapshot for the page and its count, as in GET /v1/agents: Prisma
    // loads each `select`ed relation as a SEPARATE statement, and at READ
    // COMMITTED a registry replay committing between them can show a FIXED
    // payment source whose amount rows are already gone.
    const [agents, count] = await prisma.$transaction(
      [
        prisma.agent.findMany({
          where,
          take: takePlusOne,
          skip,
          cursor: cursor ? { id: cursor } : undefined,
          orderBy: [...agentOrderBy, { id: "desc" }],
          // Narrowed to what the response actually needs. Registry entries are
          // third-party-created, so every extra column is multiplied by the
          // page size and by up to 25 payment sources of 7 amounts each.
          select: {
            id: true,
            type: true,
            name: true,
            description: true,
            image: true,
            x402ResourcesUrl: true,
            openApiSpecUrl: true,
            // Exactly the three columns the metadata getters below resolve;
            // `metadataOverride: true` would load every scalar on the row.
            metadataOverride: {
              select: { name: true, description: true, image: true },
            },
            paymentSources: {
              // OpenAPI entries can be multi-rail. Cardano/Masumi sources are
              // irrelevant to this endpoint and must not fail its EVM gates.
              where: { scheme: { not: null } },
              select: {
                network: true,
                payTo: true,
                pricingType: true,
                scheme: true,
                amounts: {
                  select: { unit: true, amount: true, decimals: true },
                  // Both relations are explicitly ordered: unordered, Prisma
                  // returns Postgres heap order, and "the first amount row for
                  // this asset" would be a different row here than at pay time.
                  orderBy: [{ unit: "asc" }, { id: "asc" }],
                },
              },
              orderBy: { sourceIndex: "asc" },
            },
          },
        }),
        prisma.agent.count({ where }),
      ],
      AGENT_PRICING_READ_TRANSACTION_OPTIONS,
    );

    // Paginate from the RAW rows, not the payable ones: the gates below drop
    // agents, and cursoring off the filtered list would park the cursor on a
    // dropped agent forever.
    const paginationRows = agents.slice(0, take);

    const listed: X402Agent[] = [];
    // Drops are silent and per-agent, so an empty listing has many causes. One
    // tally per request (not per agent) keeps an operator from having to guess
    // between "nothing registered", "nothing priced", and "everything failed
    // the network gate".
    const dropsByReason = new Map<X402ListingDropReason, number>();
    for (const agent of paginationRows) {
      if (!hasValidX402DiscoveryUrl(agent)) {
        dropsByReason.set(
          "invalid_discovery_url",
          (dropsByReason.get("invalid_discovery_url") ?? 0) + 1,
        );
        continue;
      }
      const result = buildX402AgentPricingListing(agent.paymentSources, {
        creditCosts,
        readySources,
        network,
      });
      if (result.status === "dropped") {
        // Fail closed: at least one advertised source is unpriced, on a
        // disallowed network, or not buy-side ready — hide the agent rather
        // than list a 402 the pay endpoint would reject.
        dropsByReason.set(
          result.reason,
          (dropsByReason.get(result.reason) ?? 0) + 1,
        );
        continue;
      }
      const discovery =
        agent.type === AgentEntryType.OPEN_API
          ? {
              specification: "openapi" as const,
              x402ResourcesUrl: null,
              openApiSpecUrl: agent.openApiSpecUrl,
            }
          : {
              specification: "bazaar" as const,
              x402ResourcesUrl: agent.x402ResourcesUrl,
              openApiSpecUrl: null,
            };
      const base = {
        id: agent.id,
        ...discovery,
        name: getAgentName(agent),
        description: getAgentDescription(agent),
        image: getAgentImage(agent),
      } as const;
      // The one non-drop tally: the agent stays listed as a preview, but a
      // ready pair on its network has no positive CreditCost row. Without
      // this, the state is silent everywhere — the same error on a fixed
      // agent tallies as unpriced_asset, and the sync records the pair READY.
      if (result.pricingType !== "fixed" && result.hasUnpricedReadyPair) {
        dropsByReason.set(
          "unpriced_dynamic_preview",
          (dropsByReason.get("unpriced_dynamic_preview") ?? 0) + 1,
        );
      }
      if (result.pricingType === "fixed") {
        listed.push({
          ...base,
          pricingType: "fixed",
          isPayable: true,
          paymentSources: result.paymentSources,
        });
      } else if (result.pricingType === "dynamic") {
        listed.push({
          ...base,
          pricingType: "dynamic",
          isPayable: result.isPayable,
          paymentSources: result.paymentSources,
        });
      } else {
        listed.push({
          ...base,
          pricingType: "mixed",
          isPayable: result.isPayable,
          paymentSources: result.paymentSources,
        });
      }
    }
    // A page the client did not narrow or seek into: see logX402ListingDrops
    // for why only that page may raise the warn. An explicit `limit` equal to
    // the default reads the same rows as no `limit` at all, so it counts.
    // Falsy, not `=== undefined`: `?cursor=` validates as "" and is served
    // the first page by the query above, so it must count as one here too.
    const isUnfilteredFirstPage =
      !cursor && take === LIMITS.DEFAULT_PAGINATION_LIMIT;
    const hasMore = agents.length === takePlusOne;
    logX402ListingDrops(
      listed.length,
      dropsByReason,
      isUnfilteredFirstPage,
      hasMore,
    );

    return ok(
      c,
      x402AgentsSchema.parse(listed),
      createPaginationMeta(paginationRows, count, take, hasMore, cursor),
    );
  });
}
