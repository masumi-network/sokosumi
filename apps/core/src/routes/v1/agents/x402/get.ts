import { createRoute } from "@hono/zod-openapi";
import { AgentEntryType, AgentStatus, agentOrderBy } from "@sokosumi/database";

import { LIMITS } from "@/config/constants";
import { getEnv } from "@/config/env";
import { AGENT_PRICING_READ_TRANSACTION_OPTIONS } from "@/helpers/agent";
import {
  getAgentDescription,
  getAgentImage,
  getAgentName,
} from "@/helpers/agent-metadata";
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
  buildX402AgentPaymentSources,
  type X402ListingDropReason,
} from "@/helpers/x402-agent-listing";
import { getX402ReadySources } from "@/helpers/x402-readiness";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { isCoworkerAgentContext } from "@/middleware/auth";
import { cursorPaginationQuerySchema } from "@/schemas/pagination.schema";
import { type X402Agent, x402AgentsSchema } from "@/schemas/x402-agent.schema";

/**
 * One line per request summarising which gates hid agents, never one per
 * agent. Warns only when the UNFILTERED FIRST PAGE came back empty despite
 * candidates being queried — that is the state an operator reports as "the
 * listing is broken"; partial drops are routine and stay at debug.
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
): void {
  if (dropsByReason.size === 0) {
    return;
  }
  const summary = JSON.stringify(Object.fromEntries(dropsByReason));
  if (listedCount === 0 && isUnfilteredFirstPage) {
    console.warn(
      `[agents/x402] every candidate agent was dropped as unpayable: ${summary}`,
    );
    return;
  }
  console.debug(`[agents/x402] dropped unpayable agents: ${summary}`);
}

const route = withGlobalHeaderParameters(
  createRoute({
    method: "get",
    path: "/x402",
    description:
      "List the x402/Bazaar agents Sokosumi can pay right now (coworker agents only, paginated). Fail closed: an agent appears only when every advertised payment source is priced, on an allowed network, and buy-side ready. Unpayable agents are filtered out AFTER the page is read, so a page can hold fewer items than `limit` — or none — while `nextCursor` still points at more; `total` counts candidate X402 entries, not payable ones. When the x402 rail itself is unavailable the whole listing is hidden without the catalog being read, and `total` is 0. Follow `nextCursor` until it is null.",
    tags: ["Agents"],
    request: {
      query: cursorPaginationQuerySchema,
    },
    responses: {
      200: jsonPaginatedSuccessResponse(
        x402AgentsSchema,
        "Retrieve the payable x402 agents",
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
    // Same gate as the x402 pay endpoint: only a coworker acting as itself
    // (no workspace-context headers) may list. A delegated coworker acts as a
    // user and users have no x402 surface, so both are rejected alike.
    if (!isCoworkerAgentContext(authContext)) {
      throw forbidden("Coworker agent authentication required");
    }

    const { cursor, take, skip } = parseCursorPagination(c.req.valid("query"));

    // Readiness first as a cheap early-out: an empty ready-source set (or one
    // never recorded) hides the whole listing before any other query.
    const readySources = await getX402ReadySources(prisma);
    if (readySources.length === 0) {
      // `total: 0` without counting the catalog. Counting would put a query on
      // exactly the path whose point is to cost nothing, and the number would
      // describe a page this response never read — so the documented contract
      // says 0 here rather than the count being spent to fill it in.
      return ok(
        c,
        x402AgentsSchema.parse([]),
        createPaginationMeta([], 0, take, false, cursor),
      );
    }
    // Non-throwing on purpose (NOT getCreditCostsOrThrow): an empty
    // credit_cost table must not 500 the listing. With nothing priced, every
    // agent fails the pricing gate and drops out, so the fail-closed listing
    // is simply empty — the same contract as the readiness early-out above.
    const creditCosts = await prisma.creditCost.findMany();

    const where = {
      type: AgentEntryType.X402,
      status: AgentStatus.ONLINE,
      // Same curation whitelist as the end-user catalog: an agent is listed
      // only once isShown is true. New registry entries take that flag from
      // SHOW_AGENTS_BY_DEFAULT, which defaults to false — a deployment that
      // sets it true opts every third-party X402 entry straight into the
      // listing, which is why the page below is bounded.
      isShown: true,
    };
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
            name: true,
            description: true,
            image: true,
            x402ResourcesUrl: true,
            // Exactly the three columns the metadata getters below resolve;
            // `metadataOverride: true` would load every scalar on the row.
            metadataOverride: {
              select: { name: true, description: true, image: true },
            },
            paymentSources: {
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

    const network = getEnv().NETWORK;
    const listed: X402Agent[] = [];
    // Drops are silent and per-agent, so an empty listing has many causes. One
    // tally per request (not per agent) keeps an operator from having to guess
    // between "nothing registered", "nothing priced", and "everything failed
    // the network gate".
    const dropsByReason = new Map<X402ListingDropReason, number>();
    for (const agent of paginationRows) {
      const result = buildX402AgentPaymentSources(agent.paymentSources, {
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
      listed.push({
        id: agent.id,
        name: getAgentName(agent),
        description: getAgentDescription(agent),
        image: getAgentImage(agent),
        x402ResourcesUrl: agent.x402ResourcesUrl,
        paymentSources: result.paymentSources,
      });
    }
    // A page the client did not narrow or seek into: see logX402ListingDrops
    // for why only that page may raise the warn. An explicit `limit` equal to
    // the default reads the same rows as no `limit` at all, so it counts.
    const isUnfilteredFirstPage =
      cursor === undefined && take === LIMITS.DEFAULT_PAGINATION_LIMIT;
    logX402ListingDrops(listed.length, dropsByReason, isUnfilteredFirstPage);

    return ok(
      c,
      x402AgentsSchema.parse(listed),
      createPaginationMeta(
        paginationRows,
        count,
        take,
        agents.length === takePlusOne,
        cursor,
      ),
    );
  });
}
