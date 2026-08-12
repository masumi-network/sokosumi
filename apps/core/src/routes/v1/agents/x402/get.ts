import { createRoute } from "@hono/zod-openapi";
import {
  AgentEntryType,
  AgentStatus,
  agentMetadataOverrideScalarsInclude,
  agentOrderBy,
} from "@sokosumi/database";

import { getEnv } from "@/config/env";
import {
  getAgentDescription,
  getAgentImage,
  getAgentName,
} from "@/helpers/agent-metadata";
import { forbidden } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
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
import { type X402Agent, x402AgentsSchema } from "@/schemas/x402-agent.schema";

/**
 * One line per request summarising which gates hid agents, never one per
 * agent. Warns only when the page came back empty despite candidates being
 * queried — that is the state an operator reports as "the listing is broken";
 * partial drops are routine and stay at debug.
 */
function logX402ListingDrops(
  listedCount: number,
  dropsByReason: ReadonlyMap<X402ListingDropReason, number>,
): void {
  if (dropsByReason.size === 0) {
    return;
  }
  const summary = JSON.stringify(Object.fromEntries(dropsByReason));
  if (listedCount === 0) {
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
      "List the x402/Bazaar agents Sokosumi can pay right now (coworker agents only). Fail closed: an agent appears only when every advertised payment source is priced, on an allowed network, and buy-side ready.",
    tags: ["Agents"],
    responses: {
      200: jsonSuccessResponse(
        x402AgentsSchema,
        "Retrieve the payable x402 agents",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
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

    // Readiness first as a cheap early-out: an empty ready-source set (or one
    // never recorded) hides the whole listing before any other query.
    const readySources = await getX402ReadySources(prisma);
    if (readySources.length === 0) {
      return ok(c, x402AgentsSchema.parse([]));
    }
    // Non-throwing on purpose (NOT getCreditCostsOrThrow): an empty
    // credit_cost table must not 500 the listing. With nothing priced, every
    // agent fails the pricing gate and drops out, so the fail-closed listing
    // is simply empty — the same contract as the readiness early-out above.
    const creditCosts = await prisma.creditCost.findMany();

    const agents = await prisma.agent.findMany({
      where: {
        type: AgentEntryType.X402,
        status: AgentStatus.ONLINE,
        // Same curation whitelist as the end-user catalog: production hides
        // agents until an operator whitelists them (SHOW_AGENTS_BY_DEFAULT
        // false), preprod lists everything by defaulting the flag to shown.
        isShown: true,
      },
      orderBy: [...agentOrderBy, { id: "desc" }],
      include: {
        ...agentMetadataOverrideScalarsInclude,
        paymentSources: {
          // Both relations are explicitly ordered: unordered, Prisma returns
          // Postgres heap order, and "the first amount row for this asset"
          // would be a different row here than at pay time.
          include: { amounts: { orderBy: [{ unit: "asc" }, { id: "asc" }] } },
          orderBy: { sourceIndex: "asc" },
        },
      },
    });

    const network = getEnv().NETWORK;
    const listed: X402Agent[] = [];
    // Drops are silent and per-agent, so an empty listing has many causes. One
    // tally per request (not per agent) keeps an operator from having to guess
    // between "nothing registered", "nothing priced", and "everything failed
    // the network gate".
    const dropsByReason = new Map<X402ListingDropReason, number>();
    for (const agent of agents) {
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
    logX402ListingDrops(listed.length, dropsByReason);

    return ok(c, x402AgentsSchema.parse(listed));
  });
}
