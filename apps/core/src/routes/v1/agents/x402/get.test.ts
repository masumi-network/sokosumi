import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  BASE_MAINNET,
  BASE_SEPOLIA,
  createAgentRow,
  createApp,
  createCardanoAgentRow,
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
    userAgentRating: { groupBy: () => Promise.resolve([]) },
    $transaction: prismaTransactionMock,
  },
}));

function seedReadiness(pairs: ReadinessPairFixture[]) {
  syncMetadataFindUniqueMock.mockResolvedValue(createReadinessRow(pairs));
}

describe("GET /agents?kind=x402", () => {
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

  it("returns cardano and x402 items on one unfiltered page", async () => {
    agentFindManyMock.mockResolvedValue([
      createCardanoAgentRow(),
      createAgentRow(),
    ]);
    agentCountMock.mockResolvedValue(2);
    const app = createApp();

    const response = await app.request("http://localhost/");
    const body = (await response.json()) as {
      data: Array<{ kind: string; id: string }>;
    };

    expect(response.status).toBe(200);
    expect(body.data.map((item) => item.kind)).toEqual(["cardano", "x402"]);
    expect(body.data.map((item) => item.id)).toEqual([
      "agent_cardano_1",
      "agent_x402_1",
    ]);
  });

  it("returns payable agents to an authenticated user actor", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/?kind=x402");

    expect(response.status).toBe(200);
    expect((await response.json()) as { data: unknown[] }).toMatchObject({
      data: [
        {
          id: "agent_x402_1",
          specification: "bazaar",
          x402ResourcesUrl: "https://agent.example.com/.well-known/x402",
          openApiSpecUrl: null,
        },
      ],
    });
    expect(agentFindManyMock).toHaveBeenCalled();
    expect(creditCostFindManyMock).toHaveBeenCalled();
  });

  it("labels OpenAPI x402 entries with their specification", async () => {
    agentFindManyMock.mockResolvedValue([createAgentRow({ type: "OPEN_API" })]);
    const app = createApp();

    const response = await app.request("http://localhost/?kind=x402");

    expect(response.status).toBe(200);
    expect((await response.json()) as { data: unknown[] }).toMatchObject({
      data: [
        {
          id: "agent_x402_1",
          specification: "openapi",
          x402ResourcesUrl: null,
          openApiSpecUrl: "https://agent.example.com/openapi.json",
        },
      ],
    });
  });

  it.each([
    ["X402", { x402ResourcesUrl: "javascript:alert(1)" }],
    ["OPEN_API", { openApiSpecUrl: "not-an-absolute-url" }],
  ] as const)(
    "drops a %s entry whose discovery URL is not absolute HTTP(S)",
    async (type, urlOverrides) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      agentFindManyMock.mockResolvedValue([
        createAgentRow({ type, ...urlOverrides }),
      ]);
      const app = createApp();

      const response = await app.request("http://localhost/?kind=x402");

      expect(response.status).toBe(200);
      expect((await response.json()) as { data: unknown[] }).toMatchObject({
        data: [],
      });
      expect(warn).toHaveBeenCalledWith(
        '[agents] every x402 candidate agent was dropped as unpayable: {"invalid_discovery_url":1}',
      );
    },
  );

  it("returns ready dynamic pricing as payable to a user actor", async () => {
    agentFindManyMock.mockResolvedValue([
      createAgentRow({
        paymentSources: [
          {
            sourceIndex: 0,
            network: BASE_SEPOLIA,
            payTo: PAY_TO,
            pricingType: "DYNAMIC",
            scheme: "Exact",
            amounts: [],
          },
        ],
      }),
    ]);
    const app = createApp();

    const response = await app.request("http://localhost/?kind=x402");

    expect(response.status).toBe(200);
    expect((await response.json()) as { data: unknown[] }).toMatchObject({
      data: [
        {
          id: "agent_x402_1",
          pricingType: "dynamic",
          isPayable: true,
          paymentSources: [
            {
              pricingType: "dynamic",
              caip2Network: BASE_SEPOLIA,
              payTo: PAY_TO,
            },
          ],
        },
      ],
    });
  });

  it("returns mixed fixed and dynamic payment sources", async () => {
    agentFindManyMock.mockResolvedValue([
      createAgentRow({
        paymentSources: [
          {
            sourceIndex: 0,
            network: BASE_SEPOLIA,
            payTo: PAY_TO,
            pricingType: "FIXED",
            scheme: "exact",
            amounts: [{ unit: USDC_ADDRESS, amount: 250000n, decimals: 6 }],
          },
          {
            sourceIndex: 1,
            network: BASE_SEPOLIA,
            payTo: PAY_TO,
            pricingType: "DYNAMIC",
            scheme: "exact",
            amounts: [],
          },
        ],
      }),
    ]);
    const app = createApp();

    const response = await app.request("http://localhost/?kind=x402");

    expect(response.status).toBe(200);
    expect((await response.json()) as { data: unknown[] }).toMatchObject({
      data: [
        {
          pricingType: "mixed",
          isPayable: true,
          paymentSources: [
            { asset: USDC_ADDRESS, amount: "250000" },
            { pricingType: "dynamic", caip2Network: BASE_SEPOLIA },
          ],
        },
      ],
    });
  });

  it("reports the dynamic gate that rejects a malformed preview", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    agentFindManyMock.mockResolvedValue([
      createAgentRow({
        paymentSources: [
          {
            sourceIndex: 0,
            network: BASE_SEPOLIA,
            payTo: "not-an-address",
            pricingType: "DYNAMIC",
            scheme: "exact",
            amounts: [],
          },
        ],
      }),
    ]);
    const app = createApp();

    const response = await app.request("http://localhost/?kind=x402");

    expect(response.status).toBe(200);
    expect((await response.json()) as { data: unknown[] }).toMatchObject({
      data: [],
    });
    expect(warn).toHaveBeenCalledWith(
      '[agents] every x402 candidate agent was dropped as unpayable: {"malformed_pay_to":1}',
    );
  });

  it("returns ready dynamic pricing as payable to a direct coworker", async () => {
    agentFindManyMock.mockResolvedValue([
      createAgentRow({
        paymentSources: [
          {
            sourceIndex: 0,
            network: BASE_SEPOLIA,
            payTo: PAY_TO,
            pricingType: "DYNAMIC",
            scheme: "exact",
            amounts: [],
          },
        ],
      }),
    ]);
    const app = createApp();

    const response = await app.request("http://localhost/?kind=x402");

    expect(response.status).toBe(200);
    expect((await response.json()) as { data: unknown[] }).toMatchObject({
      data: [
        {
          id: "agent_x402_1",
          pricingType: "dynamic",
          isPayable: true,
          paymentSources: [
            {
              pricingType: "dynamic",
              caip2Network: BASE_SEPOLIA,
              payTo: PAY_TO,
            },
          ],
        },
      ],
    });
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
    const app = createApp();

    const response = await app.request("http://localhost/?kind=x402");

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: unknown };
    expect(body.data).toEqual([
      {
        kind: "x402",
        id: "agent_x402_1",
        specification: "bazaar",
        name: "Override Name",
        description: "Override description",
        image: "https://c-ipfs-gw.nmkr.io/ipfs/bafyoverride",
        x402ResourcesUrl: "https://agent.example.com/.well-known/x402",
        openApiSpecUrl: null,
        pricingType: "fixed",
        isPayable: true,
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

  it("drops an X402 entry whose discovery URL is not absolute HTTP(S)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    agentFindManyMock.mockResolvedValue([
      createAgentRow({ x402ResourcesUrl: "javascript:alert(1)" }),
    ]);
    const app = createApp();

    const response = await app.request("http://localhost/?kind=x402");

    expect(response.status).toBe(200);
    expect((await response.json()) as { data: unknown[] }).toMatchObject({
      data: [],
    });
    expect(warn).toHaveBeenCalledWith(
      '[agents] every x402 candidate agent was dropped as unpayable: {"invalid_discovery_url":1}',
    );
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
    const app = createApp();

    const response = await app.request("http://localhost/?kind=x402");

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

  it("still lists dynamic previews when buy-side readiness has never been recorded", async () => {
    syncMetadataFindUniqueMock.mockResolvedValue(null);
    agentFindManyMock.mockResolvedValue([
      createAgentRow({
        paymentSources: [
          {
            sourceIndex: 0,
            network: BASE_SEPOLIA,
            payTo: PAY_TO,
            pricingType: "DYNAMIC",
            scheme: "exact",
            amounts: [],
          },
        ],
      }),
    ]);
    const app = createApp();

    const response = await app.request("http://localhost/?kind=x402");

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: unknown;
      meta: { pagination: { total: number } };
    };
    expect(body.data).toMatchObject([
      {
        id: "agent_x402_1",
        pricingType: "dynamic",
        isPayable: false,
      },
    ]);
    expect(agentFindManyMock).toHaveBeenCalled();
    expect(agentCountMock).toHaveBeenCalled();
    expect(body.meta.pagination.total).toBe(1);
  });

  it("tallies a ready-but-unpriced dynamic preview so the state has an operator surface", async () => {
    // Buy-side readiness records the pair READY, but the CAIP-19 CreditCost
    // row is missing. The agent stays listed as a non-payable preview, so
    // dropsByReason would otherwise never see it — and unlike the identical
    // operator error on a fixed agent (tallied as unpriced_asset), nothing
    // else names the missing row.
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    seedReadiness([
      {
        caip2Network: BASE_SEPOLIA,
        asset: USDC_ADDRESS,
        evmWalletId: "wallet-1",
      },
    ]);
    creditCostFindManyMock.mockResolvedValue([]);
    agentFindManyMock.mockResolvedValue([
      createAgentRow({
        paymentSources: [
          {
            sourceIndex: 0,
            network: BASE_SEPOLIA,
            payTo: PAY_TO,
            pricingType: "DYNAMIC",
            scheme: "exact",
            amounts: [],
          },
        ],
      }),
    ]);
    const app = createApp();

    const response = await app.request("http://localhost/?kind=x402");

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: unknown };
    expect(body.data).toMatchObject([
      { pricingType: "dynamic", isPayable: false },
    ]);
    expect(debug).toHaveBeenCalledWith(
      '[agents] non-payable x402 agents by reason: {"unpriced_dynamic_preview":1}',
    );
  });

  it("advertises one preview for a registry entry that repeats a dynamic source", async () => {
    // Ingestion permits one entry to repeat a source at distinct sourceIndex
    // values; a repeat is one preview, not two (mirrors the fixed builder's
    // triple dedupe — only the payTo spelling case-folds).
    agentFindManyMock.mockResolvedValue([
      createAgentRow({
        paymentSources: [
          // One recipient in two checksum spellings — letters-bearing on
          // purpose: an all-digit address is byte-identical under case
          // changes and would make the fold fixture vacuous.
          {
            sourceIndex: 0,
            network: BASE_SEPOLIA,
            payTo: `0x${"aabb".repeat(10)}`,
            pricingType: "DYNAMIC",
            scheme: "exact",
            amounts: [],
          },
          {
            sourceIndex: 1,
            network: BASE_SEPOLIA,
            payTo: `0x${"AABB".repeat(10)}`,
            pricingType: "DYNAMIC",
            scheme: "exact",
            amounts: [],
          },
        ],
      }),
    ]);
    const app = createApp();

    const response = await app.request("http://localhost/?kind=x402");

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: Array<{ paymentSources: unknown[] }>;
    };
    expect(body.data).toMatchObject([
      { pricingType: "dynamic", isPayable: true },
    ]);
    expect(body.data[0]?.paymentSources).toHaveLength(1);
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
    const app = createApp();

    const response = await app.request("http://localhost/?kind=x402");

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: unknown };
    expect(body.data).toEqual([]);
  });

  it("drops an agent whose advertised asset has no CreditCost row", async () => {
    // The advertised asset must be trusted AND buy-side ready so the drop
    // can only come from the pricing gate: an untrusted or unready asset
    // would drop earlier as not_buy_side_ready and this test would pass
    // without ever exercising the CreditCost lookup. The credit_cost table
    // is non-empty (a row for another unit) to distinguish this from the
    // empty-table test above; the reason tally pins the exact gate.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
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
            amounts: [{ unit: USDC_ADDRESS, amount: 250000n, decimals: 6 }],
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
    ]);
    creditCostFindManyMock.mockResolvedValue([
      createCreditCostRow(`${BASE_SEPOLIA}/erc20:${UNPRICED_ADDRESS}`, 100n),
    ]);
    const app = createApp();

    const response = await app.request("http://localhost/?kind=x402");

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { id: string }[] };
    expect(body.data).toEqual([]);
    // The sole candidate dropped on the unfiltered first page, so the tally
    // rides the warn line; the reason pins the pricing gate specifically.
    expect(warn).toHaveBeenCalledWith(
      '[agents] every x402 candidate agent was dropped as unpayable: {"unpriced_asset":1}',
    );
    warn.mockRestore();
    debug.mockRestore();
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
    const app = createApp();

    const response = await app.request("http://localhost/?kind=x402");

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: unknown };
    expect(body.data).toEqual([]);
    // One line for the whole request, naming which gate hid what.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      '[agents] every x402 candidate agent was dropped as unpayable: {"not_buy_side_ready":1,"unsupported_scheme":1,"no_payment_source":1}',
    );
  });

  it("does not warn when every candidate on the first page drops but later pages remain", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    agentFindManyMock.mockResolvedValue(
      Array.from({ length: 21 }, (_, index) =>
        createAgentRow({
          id: `agent_x402_upto_${index}`,
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
      ),
    );
    agentCountMock.mockResolvedValue(21);
    const app = createApp();

    const response = await app.request("http://localhost/?kind=x402");

    expect(response.status).toBe(200);
    expect(warn).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalledWith(
      '[agents] non-payable x402 agents by reason: {"unsupported_scheme":20}',
    );
  });

  it("stays quiet when every candidate agent is payable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const app = createApp();

    const response = await app.request("http://localhost/?kind=x402");

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
    const app = createApp();

    const response = await app.request("http://localhost/?kind=x402");

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
    const app = createApp();

    const response = await app.request(
      "http://localhost/?kind=x402&cursor=agent_x402_0",
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: unknown };
    expect(body.data).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
    // The per-reason tally survives the demotion — it is the only thing that
    // tells "nothing priced" apart from "everything failed the network gate".
    expect(debug).toHaveBeenCalledWith(
      '[agents] non-payable x402 agents by reason: {"unsupported_scheme":1}',
    );
  });

  it("still warns on an all-dropped page reached via an EMPTY cursor value", async () => {
    // `?cursor=` validates as "" and the query treats it as no cursor at all —
    // the client chose nothing, so the page is the same unfiltered first page
    // and must keep its warn. Guarding with `=== undefined` instead of
    // falsiness would silently demote exactly this request.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
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
    agentCountMock.mockResolvedValue(1);
    const app = createApp();

    const response = await app.request("http://localhost/?kind=x402&cursor=");

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: unknown };
    expect(body.data).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      '[agents] every x402 candidate agent was dropped as unpayable: {"unsupported_scheme":1}',
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
    const app = createApp();

    const response = await app.request("http://localhost/?kind=x402&limit=1");

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: unknown };
    expect(body.data).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalledWith(
      '[agents] non-payable x402 agents by reason: {"unsupported_scheme":1}',
    );
  });

  it("does not warn when the first raw page drops but a later page remains", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    agentFindManyMock.mockResolvedValue(
      Array.from({ length: 21 }, (_, index) =>
        createAgentRow({
          id: `agent_x402_${index}`,
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
      ),
    );
    const app = createApp();

    const response = await app.request("http://localhost/?kind=x402");

    expect(response.status).toBe(200);
    expect(warn).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalledWith(
      '[agents] non-payable x402 agents by reason: {"unsupported_scheme":20}',
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
    const app = createApp();

    const response = await app.request("http://localhost/?kind=x402");

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
    const app = createApp();

    const response = await app.request("http://localhost/?kind=x402");

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
      '[agents] non-payable x402 agents by reason: {"network_not_allowed":1}',
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
    const app = createApp();

    const response = await app.request("http://localhost/?kind=x402");

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: unknown };
    expect(body.data).toEqual([]);
  });
});
