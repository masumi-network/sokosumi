import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  BASE_MAINNET,
  BASE_SEPOLIA,
  COWORKER_AGENT_CONTEXT,
  createAgentRow,
  createApp,
  createCreditCostRow,
  createReadinessRow,
  NODE_DECIMALS,
  PAY_TO,
  type ReadinessPairFixture,
  UNPRICED_ADDRESS,
  USDC_ADDRESS,
} from "./get.fixtures";

/**
 * Who may list, which agents survive the fail-closed gates, and what the
 * route logs about the ones it hid. The shape of the catalog query itself —
 * pagination, ordering, snapshot isolation, column narrowing — lives in
 * `get.query.test.ts`.
 */
const {
  agentCountMock,
  agentFindManyMock,
  creditCostFindManyMock,
  prismaTransactionMock,
  syncMetadataFindUniqueMock,
} = vi.hoisted(() => ({
  agentCountMock: vi.fn(),
  agentFindManyMock: vi.fn(),
  creditCostFindManyMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
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
    $transaction: prismaTransactionMock,
  },
}));

function seedReadiness(pairs: ReadinessPairFixture[]) {
  syncMetadataFindUniqueMock.mockResolvedValue(createReadinessRow(pairs));
}

describe("GET /agents/x402", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Batch form: Prisma resolves the array of operations together, which is
    // what gives the page and its count one snapshot.
    prismaTransactionMock.mockImplementation(async (operations: unknown) =>
      Array.isArray(operations) ? await Promise.all(operations) : operations,
    );
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

  it("advertises the cached node decimals over the agent's registered scale", async () => {
    // End-to-end wiring of the money field: the readiness cache carries the
    // node's `defaultAssetDecimals`, and that — not the agent's own registry
    // entry — is what the listing prices and advertises. Registering 18 for a
    // 6-decimals USDC would otherwise advertise 1e-10 credits for a real
    // dollar the managed wallet then signs away.
    agentFindManyMock.mockResolvedValue([
      createAgentRow({
        paymentSources: [
          {
            sourceIndex: 0,
            network: BASE_SEPOLIA,
            payTo: PAY_TO,
            pricingType: "FIXED",
            scheme: "exact",
            amounts: [{ unit: USDC_ADDRESS, amount: 250000n, decimals: 18 }],
          },
        ],
      }),
    ]);
    const app = createApp(COWORKER_AGENT_CONTEXT);

    const response = await app.request("http://localhost/x402");

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { paymentSources: unknown[] }[];
    };
    expect(body.data[0]?.paymentSources).toEqual([
      {
        caip2Network: BASE_SEPOLIA,
        asset: USDC_ADDRESS,
        decimals: NODE_DECIMALS,
        payTo: PAY_TO,
        amount: "250000",
        credits: 0.5,
      },
    ]);
  });

  it("hides the entire listing when buy-side readiness has never been recorded", async () => {
    syncMetadataFindUniqueMock.mockResolvedValue(null);
    const app = createApp(COWORKER_AGENT_CONTEXT);

    const response = await app.request("http://localhost/x402");

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: unknown;
      meta: { pagination: { total: number } };
    };
    expect(body.data).toEqual([]);
    // Fail closed before touching the catalog.
    expect(agentFindManyMock).not.toHaveBeenCalled();
    expect(agentCountMock).not.toHaveBeenCalled();
    // Documented contract for this path: nothing was counted, so total is 0.
    expect(body.meta.pagination.total).toBe(0);
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

  it("stays quiet on a cursored all-dropped page", async () => {
    // `cursor` is client-supplied, so a coworker can aim a page straight at an
    // unpayable agent and make `listedCount === 0` hold on a perfectly healthy
    // deployment — one warn per request, looped at will. Only the unfiltered
    // first page, whose contents no client chooses, may warn.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    agentFindManyMock.mockResolvedValue([
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
    agentCountMock.mockResolvedValue(9);
    const app = createApp(COWORKER_AGENT_CONTEXT);

    const response = await app.request(
      "http://localhost/x402?cursor=agent_x402_0",
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: unknown };
    expect(body.data).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
    // The per-reason tally survives the demotion — it is the only thing that
    // tells "nothing priced" apart from "everything failed the network gate".
    expect(debug).toHaveBeenCalledWith(
      '[agents/x402] dropped unpayable agents: {"unsupported_scheme":1}',
    );
  });

  it("stays quiet on a client-narrowed all-dropped page", async () => {
    // The second client-selectable input: `limit=1` slices the catalog down to
    // one agent, so any unpayable agent anywhere in the listing can be made
    // the whole page. Narrowing the page must not be a way to raise a warn.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    agentFindManyMock.mockResolvedValue([
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
      createAgentRow({ id: "agent_x402_next" }),
    ]);
    agentCountMock.mockResolvedValue(9);
    const app = createApp(COWORKER_AGENT_CONTEXT);

    const response = await app.request("http://localhost/x402?limit=1");

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: unknown };
    expect(body.data).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalledWith(
      '[agents/x402] dropped unpayable agents: {"unsupported_scheme":1}',
    );
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
