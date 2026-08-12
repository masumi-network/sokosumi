import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { formatZodErrorMessage, unprocessableEntity } from "@/helpers/error";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountGetX402Agents from "./get";

const {
  agentCountMock,
  agentFindManyMock,
  creditCostFindManyMock,
  syncMetadataFindUniqueMock,
} = vi.hoisted(() => ({
  agentCountMock: vi.fn(),
  agentFindManyMock: vi.fn(),
  creditCostFindManyMock: vi.fn(),
  syncMetadataFindUniqueMock: vi.fn(),
}));

// Pin the environment split without discarding the rest of the config —
// modules loaded through the route's import graph (Stripe client via
// lib/auth) read other env keys at module load.
vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({
      ...actual.getEnv(),
      NETWORK: "Preprod" as const,
    }),
  };
});

vi.mock("@/lib/db/prisma", () => ({
  default: {
    agent: { findMany: agentFindManyMock, count: agentCountMock },
    creditCost: { findMany: creditCostFindManyMock },
    syncMetadata: { findUnique: syncMetadataFindUniqueMock },
    // The route reads the page and its count in one snapshot; the mocked
    // client resolves the batch straight through.
    $transaction: (operations: Promise<unknown>[]) => Promise.all(operations),
  },
}));

const BASE_SEPOLIA = "eip155:84532";
const BASE_MAINNET = "eip155:8453";
const USDC_ADDRESS = "0x036cbd53842c5426634e7929541ec2318f3dcf7e";
const UNPRICED_ADDRESS = "0x2222222222222222222222222222222222222222";
const PAY_TO = "0x1111111111111111111111111111111111111111";

const COWORKER_AGENT_CONTEXT: AuthVariables["authContext"] = {
  actor: "coworker",
  coworkerId: "coworker_1",
  vendorId: "vendor_1",
};

function createApp(authContext: AuthVariables["authContext"]) {
  const app = new OpenAPIHono<{
    Variables: AuthVariables;
  }>({
    defaultHook: (result) => {
      if (!result.success && result.error) {
        throw unprocessableEntity(formatZodErrorMessage(result.error));
      }
    },
  });

  app.use("*", async (c, next) => {
    c.set("requestId", "test-req-id");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  mountGetX402Agents(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

function seedReadiness(
  pairs: { caip2Network: string; asset: string; evmWalletId: string }[],
) {
  syncMetadataFindUniqueMock.mockResolvedValue({
    key: "x402-buy-side-readiness",
    cursorId: JSON.stringify(pairs),
    lastSyncedAt: new Date(),
  });
}

function createCreditCostRow(unit: string, centsPerUnit: bigint) {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    id: `credit-cost-${unit}`,
    createdAt: now,
    updatedAt: now,
    unit,
    centsPerUnit,
  };
}

interface AgentRowOverrides {
  id?: string;
  metadataOverride?: {
    name: string | null;
    description: string | null;
    image: string | null;
  } | null;
  paymentSources?: unknown[];
}

function createAgentRow(overrides: AgentRowOverrides = {}) {
  return {
    id: overrides.id ?? "agent_x402_1",
    name: "Registry Name",
    description: "Registry description",
    image: "https://registry.example.com/image.png",
    x402ResourcesUrl: "https://agent.example.com/.well-known/x402",
    metadataOverride:
      overrides.metadataOverride === undefined
        ? null
        : overrides.metadataOverride,
    paymentSources: overrides.paymentSources ?? [
      {
        sourceIndex: 0,
        network: BASE_SEPOLIA,
        payTo: PAY_TO,
        pricingType: "FIXED",
        scheme: "exact",
        amounts: [{ unit: USDC_ADDRESS, amount: 250000n, decimals: 6 }],
      },
    ],
  };
}

describe("GET /agents/x402", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    seedReadiness([
      {
        caip2Network: BASE_SEPOLIA,
        asset: USDC_ADDRESS,
        evmWalletId: "wallet-1",
      },
    ]);
    creditCostFindManyMock.mockResolvedValue([
      // 2 credits per whole USDC.
      createCreditCostRow(
        `${BASE_SEPOLIA}/erc20:${USDC_ADDRESS}`,
        2n * 10n ** 10n,
      ),
    ]);
    agentFindManyMock.mockResolvedValue([createAgentRow()]);
    agentCountMock.mockResolvedValue(1);
  });

  it("rejects a user session actor with 403 before any catalog read", async () => {
    const app = createApp({
      actor: "user",
      userId: "user_1",
      organizationId: null,
      role: "user",
    });

    const response = await app.request("http://localhost/x402");

    expect(response.status).toBe(403);
    expect(agentFindManyMock).not.toHaveBeenCalled();
    expect(creditCostFindManyMock).not.toHaveBeenCalled();
  });

  it("rejects a delegated coworker (workspace context) with 403", async () => {
    // A coworker with context headers acts as the user; the x402 surface is
    // agent-only, so delegation must not open it.
    const app = createApp({
      ...COWORKER_AGENT_CONTEXT,
      context: { userId: "user_1", organizationId: null },
    });

    const response = await app.request("http://localhost/x402");

    expect(response.status).toBe(403);
    expect(agentFindManyMock).not.toHaveBeenCalled();
  });

  it("rejects an orchestrator actor with 403", async () => {
    const app = createApp({ actor: "orchestrator" });

    const response = await app.request("http://localhost/x402");

    expect(response.status).toBe(403);
    expect(agentFindManyMock).not.toHaveBeenCalled();
  });

  it("returns the payable agent with resolved overrides and converted credits", async () => {
    agentFindManyMock.mockResolvedValue([
      createAgentRow({
        metadataOverride: {
          name: "Override Name",
          description: "Override description",
          image: "ipfs://bafyoverride",
        },
      }),
    ]);
    const app = createApp(COWORKER_AGENT_CONTEXT);

    const response = await app.request("http://localhost/x402");

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: unknown };
    expect(body.data).toEqual([
      {
        id: "agent_x402_1",
        name: "Override Name",
        description: "Override description",
        image: "https://c-ipfs-gw.nmkr.io/ipfs/bafyoverride",
        x402ResourcesUrl: "https://agent.example.com/.well-known/x402",
        paymentSources: [
          {
            caip2Network: BASE_SEPOLIA,
            asset: USDC_ADDRESS,
            decimals: 6,
            payTo: PAY_TO,
            // ceil(250000 * 2e10 / 1e6) = 5e9 cents = 0.5 credits.
            amount: "250000",
            credits: 0.5,
          },
        ],
      },
    ]);
  });

  it("only queries shown, online X402 entries (curation and status gate in SQL)", async () => {
    const app = createApp(COWORKER_AGENT_CONTEXT);

    const response = await app.request("http://localhost/x402");

    expect(response.status).toBe(200);
    expect(agentFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          type: "X402",
          status: "ONLINE",
          isShown: true,
        },
      }),
    );
  });

  it("bounds the catalog page and reports pagination metadata", async () => {
    // Registry entries are third-party-created. Without a bound, one listing
    // call loads every X402 agent with every payment source and amount row.
    const app = createApp(COWORKER_AGENT_CONTEXT);

    const response = await app.request("http://localhost/x402");

    expect(response.status).toBe(200);
    const query = agentFindManyMock.mock.calls[0]?.[0];
    // One over the page size is how the next-page probe works.
    expect(query.take).toBe(21);
    expect(query.cursor).toBeUndefined();
    expect(query.skip).toBeUndefined();
    const body = (await response.json()) as {
      meta: { pagination: unknown };
    };
    expect(body.meta.pagination).toEqual({
      cursor: null,
      limit: 20,
      total: 1,
      nextCursor: null,
    });
  });

  it("hands back a next cursor keyed on the raw page, not the payable subset", async () => {
    // Cursoring off the FILTERED list would park the cursor on a dropped
    // agent forever. The last RAW row of the page is the cursor.
    const rawPage = Array.from({ length: 3 }, (_, index) =>
      createAgentRow({
        id: `agent_x402_${index}`,
        // Only the first is payable; the rest must still advance the cursor.
        paymentSources:
          index === 0
            ? undefined
            : [
                {
                  sourceIndex: 0,
                  network: BASE_SEPOLIA,
                  payTo: PAY_TO,
                  pricingType: "FIXED",
                  scheme: "upto",
                  amounts: [
                    { unit: USDC_ADDRESS, amount: 250000n, decimals: 6 },
                  ],
                },
              ],
      }),
    );
    agentFindManyMock.mockResolvedValue(rawPage);
    agentCountMock.mockResolvedValue(9);
    const app = createApp(COWORKER_AGENT_CONTEXT);

    const response = await app.request("http://localhost/x402?limit=2");

    expect(response.status).toBe(200);
    expect(agentFindManyMock.mock.calls[0]?.[0].take).toBe(3);
    const body = (await response.json()) as {
      data: { id: string }[];
      meta: {
        pagination: { limit: number; total: number; nextCursor: string };
      };
    };
    expect(body.data.map((agent) => agent.id)).toEqual(["agent_x402_0"]);
    expect(body.meta.pagination).toEqual({
      cursor: null,
      limit: 2,
      total: 9,
      // Second raw row of the page, even though it was dropped.
      nextCursor: "agent_x402_1",
    });
  });

  it("resumes from a supplied cursor", async () => {
    const app = createApp(COWORKER_AGENT_CONTEXT);

    const response = await app.request(
      "http://localhost/x402?cursor=agent_x402_0&limit=5",
    );

    expect(response.status).toBe(200);
    const query = agentFindManyMock.mock.calls[0]?.[0];
    expect(query.cursor).toEqual({ id: "agent_x402_0" });
    // Skip the cursor row itself.
    expect(query.skip).toBe(1);
    expect(query.take).toBe(6);
  });

  it("rejects a limit above the maximum instead of honouring it", async () => {
    const app = createApp(COWORKER_AGENT_CONTEXT);

    const response = await app.request("http://localhost/x402?limit=5000");

    expect(response.status).toBe(422);
    expect(agentFindManyMock).not.toHaveBeenCalled();
  });

  it("orders amount rows deterministically so row identity is stable", async () => {
    // Unordered, the relation comes back in Postgres heap order and the
    // listing's "first row for this asset" can disagree with the pay
    // endpoint's — the same triple resolving to two different prices.
    const app = createApp(COWORKER_AGENT_CONTEXT);

    const response = await app.request("http://localhost/x402");

    expect(response.status).toBe(200);
    const query = agentFindManyMock.mock.calls[0]?.[0];
    expect(query.select.paymentSources.select.amounts.orderBy).toEqual([
      { unit: "asc" },
      { id: "asc" },
    ]);
    expect(query.select.paymentSources.orderBy).toEqual({ sourceIndex: "asc" });
  });

  it("hides the entire listing when buy-side readiness has never been recorded", async () => {
    syncMetadataFindUniqueMock.mockResolvedValue(null);
    const app = createApp(COWORKER_AGENT_CONTEXT);

    const response = await app.request("http://localhost/x402");

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: unknown };
    expect(body.data).toEqual([]);
    // Fail closed before touching the catalog.
    expect(agentFindManyMock).not.toHaveBeenCalled();
  });

  it("returns an empty listing (not 500) when the credit_cost table is empty", async () => {
    // Ready sources exist, but nothing is priced. The listing must fail closed
    // to an empty array — every agent drops out of the pricing gate — not 500
    // out of a throwing credit-cost read.
    seedReadiness([
      {
        caip2Network: BASE_SEPOLIA,
        asset: USDC_ADDRESS,
        evmWalletId: "wallet-1",
      },
    ]);
    creditCostFindManyMock.mockResolvedValue([]);
    agentFindManyMock.mockResolvedValue([createAgentRow()]);
    const app = createApp(COWORKER_AGENT_CONTEXT);

    const response = await app.request("http://localhost/x402");

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: unknown };
    expect(body.data).toEqual([]);
  });

  it("drops an agent whose advertised asset has no CreditCost row", async () => {
    agentFindManyMock.mockResolvedValue([
      createAgentRow(),
      createAgentRow({
        id: "agent_x402_unpriced",
        paymentSources: [
          {
            sourceIndex: 0,
            network: BASE_SEPOLIA,
            payTo: PAY_TO,
            pricingType: "FIXED",
            scheme: "exact",
            amounts: [{ unit: UNPRICED_ADDRESS, amount: 250000n, decimals: 6 }],
          },
        ],
      }),
    ]);
    seedReadiness([
      {
        caip2Network: BASE_SEPOLIA,
        asset: USDC_ADDRESS,
        evmWalletId: "wallet-1",
      },
      {
        caip2Network: BASE_SEPOLIA,
        asset: UNPRICED_ADDRESS,
        evmWalletId: "wallet-1",
      },
    ]);
    const app = createApp(COWORKER_AGENT_CONTEXT);

    const response = await app.request("http://localhost/x402");

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { id: string }[] };
    expect(body.data.map((agent) => agent.id)).toEqual(["agent_x402_1"]);
  });

  it("warns once with a per-reason tally when every candidate is dropped", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    agentFindManyMock.mockResolvedValue([
      createAgentRow({
        id: "agent_x402_unpriced",
        paymentSources: [
          {
            sourceIndex: 0,
            network: BASE_SEPOLIA,
            payTo: PAY_TO,
            pricingType: "FIXED",
            scheme: "exact",
            amounts: [{ unit: UNPRICED_ADDRESS, amount: 250000n, decimals: 6 }],
          },
        ],
      }),
      createAgentRow({
        id: "agent_x402_upto",
        paymentSources: [
          {
            sourceIndex: 0,
            network: BASE_SEPOLIA,
            payTo: PAY_TO,
            pricingType: "FIXED",
            scheme: "upto",
            amounts: [{ unit: USDC_ADDRESS, amount: 250000n, decimals: 6 }],
          },
        ],
      }),
      createAgentRow({ id: "agent_x402_no_source", paymentSources: [] }),
    ]);
    seedReadiness([
      {
        caip2Network: BASE_SEPOLIA,
        asset: USDC_ADDRESS,
        evmWalletId: "wallet-1",
      },
      {
        caip2Network: BASE_SEPOLIA,
        asset: UNPRICED_ADDRESS,
        evmWalletId: "wallet-1",
      },
    ]);
    const app = createApp(COWORKER_AGENT_CONTEXT);

    const response = await app.request("http://localhost/x402");

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: unknown };
    expect(body.data).toEqual([]);
    // One line for the whole request, naming which gate hid what.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      '[agents/x402] every candidate agent was dropped as unpayable: {"unpriced_asset":1,"unsupported_scheme":1,"no_payment_source":1}',
    );
  });

  it("stays quiet when every candidate agent is payable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const app = createApp(COWORKER_AGENT_CONTEXT);

    const response = await app.request("http://localhost/x402");

    expect(response.status).toBe(200);
    expect(warn).not.toHaveBeenCalled();
    expect(debug).not.toHaveBeenCalled();
  });

  it("stays quiet when the page holds no candidate agents at all", async () => {
    // An empty page is not an anomaly — a coworker paging past the end, or a
    // deployment with no X402 entries yet, hits it on every poll. Warning here
    // would make client traffic drive warn volume, so nothing is logged.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    agentFindManyMock.mockResolvedValue([]);
    agentCountMock.mockResolvedValue(0);
    const app = createApp(COWORKER_AGENT_CONTEXT);

    const response = await app.request("http://localhost/x402");

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: unknown };
    expect(body.data).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
    expect(debug).not.toHaveBeenCalled();
  });

  it("drops an agent advertising a payment scheme other than exact", async () => {
    // `scheme` is what the payer signs against. A priced, allowed, ready
    // source in an unknown scheme is not payable, so it must not be listed.
    agentFindManyMock.mockResolvedValue([
      createAgentRow(),
      createAgentRow({
        id: "agent_x402_upto",
        paymentSources: [
          {
            sourceIndex: 0,
            network: BASE_SEPOLIA,
            payTo: PAY_TO,
            pricingType: "FIXED",
            scheme: "upto",
            amounts: [{ unit: USDC_ADDRESS, amount: 250000n, decimals: 6 }],
          },
        ],
      }),
    ]);
    const app = createApp(COWORKER_AGENT_CONTEXT);

    const response = await app.request("http://localhost/x402");

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { id: string }[] };
    expect(body.data.map((agent) => agent.id)).toEqual(["agent_x402_1"]);
  });

  it("drops an agent advertising a network outside the per-env allowlist", async () => {
    // Seeding ONLY the mainnet pair would make this vacuous: readiness
    // re-filters it away, the ready set empties, and the handler returns at
    // the early-out without ever querying agents or running a gate. An
    // allowed Base Sepolia pair alongside it keeps the request on the real
    // path, so the mainnet agent has to be dropped by a gate.
    agentFindManyMock.mockResolvedValue([
      createAgentRow(),
      createAgentRow({
        id: "agent_x402_mainnet",
        paymentSources: [
          {
            sourceIndex: 0,
            network: BASE_MAINNET,
            payTo: PAY_TO,
            pricingType: "FIXED",
            scheme: "exact",
            amounts: [{ unit: USDC_ADDRESS, amount: 250000n, decimals: 6 }],
          },
        ],
      }),
    ]);
    creditCostFindManyMock.mockResolvedValue([
      createCreditCostRow(
        `${BASE_SEPOLIA}/erc20:${USDC_ADDRESS}`,
        2n * 10n ** 10n,
      ),
      // Priced on mainnet too, so pricing is not what drops it.
      createCreditCostRow(
        `${BASE_MAINNET}/erc20:${USDC_ADDRESS}`,
        2n * 10n ** 10n,
      ),
    ]);
    seedReadiness([
      {
        caip2Network: BASE_SEPOLIA,
        asset: USDC_ADDRESS,
        evmWalletId: "wallet-1",
      },
      // A mainnet pair sitting in the Preprod cache — written by an older
      // build or an instance pointed at the other environment. Reading
      // readiness must re-filter it, so it can never make a mainnet source
      // look payable here.
      {
        caip2Network: BASE_MAINNET,
        asset: USDC_ADDRESS,
        evmWalletId: "wallet-1",
      },
    ]);
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const app = createApp(COWORKER_AGENT_CONTEXT);

    const response = await app.request("http://localhost/x402");

    expect(response.status).toBe(200);
    // The catalog WAS queried and the per-agent gates ran: the Preprod agent
    // survives, the mainnet one does not.
    expect(agentFindManyMock).toHaveBeenCalled();
    const body = (await response.json()) as { data: { id: string }[] };
    expect(body.data.map((agent) => agent.id)).toEqual(["agent_x402_1"]);
    // Assert WHICH gate dropped it, not merely that it is absent. Readiness
    // re-filters the seeded mainnet pair away under NETWORK=Preprod, so
    // deleting the per-source network gate would still drop this agent — as
    // not_buy_side_ready. Only the reason tells the gate under test apart from
    // that independent second defence.
    expect(debug).toHaveBeenCalledWith(
      '[agents/x402] dropped unpayable agents: {"network_not_allowed":1}',
    );
  });

  it("drops an agent whose (network, asset) pair is not buy-side ready", async () => {
    seedReadiness([
      {
        caip2Network: BASE_SEPOLIA,
        asset: UNPRICED_ADDRESS,
        evmWalletId: "wallet-1",
      },
    ]);
    const app = createApp(COWORKER_AGENT_CONTEXT);

    const response = await app.request("http://localhost/x402");

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: unknown };
    expect(body.data).toEqual([]);
  });
});
