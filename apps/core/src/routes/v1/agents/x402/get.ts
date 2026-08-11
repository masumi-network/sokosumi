import { createRoute } from "@hono/zod-openapi";
import {
  AgentEntryType,
  AgentStatus,
  agentMetadataOverrideScalarsInclude,
  agentOrderBy,
} from "@sokosumi/database";

import { getEnv } from "@/config/env";
import { getCreditCostsOrThrow } from "@/helpers/agent";
import {
  getAgentDescription,
  getAgentImage,
  getAgentName,
} from "@/helpers/agent-metadata";
import { forbidden } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { buildX402AgentPaymentSources } from "@/helpers/x402-agent-listing";
import { getX402ReadySources } from "@/helpers/x402-readiness";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { isCoworkerAgentContext } from "@/middleware/auth";
import { type X402Agent, x402AgentsSchema } from "@/schemas/x402-agent.schema";

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

    const [creditCosts, readySources] = await Promise.all([
      getCreditCostsOrThrow(prisma),
      getX402ReadySources(prisma),
    ]);
    // Fail closed before touching the catalog: no recorded buy-side-ready
    // pair (or readiness never recorded at all) hides the entire listing.
    if (readySources.length === 0) {
      return ok(c, x402AgentsSchema.parse([]));
    }

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
          include: { amounts: true },
          orderBy: { sourceIndex: "asc" },
        },
      },
    });

    const network = getEnv().NETWORK;
    const listed: X402Agent[] = [];
    for (const agent of agents) {
      const paymentSources = buildX402AgentPaymentSources(
        agent.paymentSources,
        { creditCosts, readySources, network },
      );
      if (!paymentSources || paymentSources.length === 0) {
        // Fail closed: at least one advertised source is unpriced, on a
        // disallowed network, or not buy-side ready — hide the agent rather
        // than list a 402 the pay endpoint would reject.
        continue;
      }
      listed.push({
        id: agent.id,
        name: getAgentName(agent),
        description: getAgentDescription(agent),
        image: getAgentImage(agent),
        x402ResourcesUrl: agent.x402ResourcesUrl,
        paymentSources,
      });
    }

    return ok(c, x402AgentsSchema.parse(listed));
  });
}
