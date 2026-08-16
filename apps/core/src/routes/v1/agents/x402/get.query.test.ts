import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  BASE_MAINNET,
  BASE_SEPOLIA,
  COWORKER_AGENT_CONTEXT,
  createAgentRow,
  createApp,
  createCreditCostRow,
  createReadinessRow,
  PAY_TO,
  USDC_ADDRESS,
} from "./get.fixtures";

/**
 * How the listing ASKS Postgres for its page: pagination bounds, the cursor
 * and its tiebreak, relation ordering, the shared snapshot, and the narrowed
 * column set. The per-agent fail-closed gates, authorization, and drop
 * logging live in `get.test.ts`.
 */
const {
  agentCountMock,
  agentFindManyMock,
  creditCostFindManyMock,
  prismaTransactionMock,
  syncMetadataFindUniqueMock,
  networkState,
} = vi.hoisted(() => ({
  agentCountMock: vi.fn(),
  agentFindManyMock: vi.fn(),
  creditCostFindManyMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  syncMetadataFindUniqueMock: vi.fn(),
  networkState: { value: "Preprod" as "Preprod" | "Mainnet" },
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
      NETWORK: networkState.value,
    }),
  };
});

vi.mock("@/lib/db/prisma", () => ({
  default: {
    agent: { findMany: agentFindManyMock, count: agentCountMock },
    creditCost: { findMany: creditCostFindManyMock },
    syncMetadata: { findUnique: syncMetadataFindUniqueMock },
    // A spy, not a bare passthrough: the snapshot's ISOLATION LEVEL is the
    // second argument, and a mock that discarded it left the option free to
    // delete with every test still green.
    $transaction: prismaTransactionMock,
  },
}));

describe("GET /agents/x402 catalog query", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    networkState.value = "Preprod";

    // Batch form: Prisma resolves the array of operations together, which is
    // what gives the page and its count one snapshot. The mock mirrors that
    // while recording the options argument.
    prismaTransactionMock.mockImplementation(async (operations: unknown) =>
      Array.isArray(operations) ? await Promise.all(operations) : operations,
    );
    syncMetadataFindUniqueMock.mockResolvedValue(
      createReadinessRow([
        {
          caip2Network: BASE_SEPOLIA,
          asset: USDC_ADDRESS,
          evmWalletId: "wallet-1",
        },
      ]),
    );
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

  it("queries every online X402 entry with a discovery URL on Preprod", async () => {
    const app = createApp(COWORKER_AGENT_CONTEXT);

    const response = await app.request("http://localhost/x402");

    expect(response.status).toBe(200);
    expect(agentFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          type: "X402",
          status: "ONLINE",
          x402ResourcesUrl: { not: null },
        },
      }),
    );
  });

  it("requires curated agents in the Mainnet catalog query", async () => {
    networkState.value = "Mainnet";
    syncMetadataFindUniqueMock.mockResolvedValue(
      createReadinessRow([
        {
          caip2Network: BASE_MAINNET,
          asset: USDC_ADDRESS,
          evmWalletId: "wallet-1",
        },
      ]),
    );
    const app = createApp(COWORKER_AGENT_CONTEXT);

    const response = await app.request("http://localhost/x402");

    expect(response.status).toBe(200);
    expect(agentFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          type: "X402",
          status: "ONLINE",
          x402ResourcesUrl: { not: null },
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

  it("reads the page and its count in one repeatable-read snapshot", async () => {
    // Prisma loads each selected relation as a SEPARATE statement. At READ
    // COMMITTED a registry replay committing between them returns a FIXED
    // payment source whose amount rows are already gone, so the listing
    // advertises a price whose row no longer exists — listed but unpayable,
    // the one invariant this route exists to hold. The BATCH form gets a
    // shared snapshot without holding a pool connection across app code.
    const app = createApp(COWORKER_AGENT_CONTEXT);

    const response = await app.request("http://localhost/x402");

    expect(response.status).toBe(200);
    // The real AGENT_PRICING_READ_TRANSACTION_OPTIONS — this file does not
    // mock @/helpers/agent — so the literal pins the shipped value.
    expect(prismaTransactionMock).toHaveBeenCalledWith(expect.any(Array), {
      isolationLevel: "RepeatableRead",
    });
    expect(agentFindManyMock).toHaveBeenCalled();
    expect(agentCountMock).toHaveBeenCalled();
  });

  it("breaks the non-unique catalog order with a unique id tiebreak", async () => {
    // `agentOrderBy` is (jobCount desc, createdAt desc) and neither column is
    // unique. Cursor pagination resolves the cursor row's sort key and reads
    // on from there, so without a unique final key agents sharing a
    // (jobCount, createdAt) can be skipped or repeated across pages — a
    // payable agent that no amount of paging ever reveals.
    const app = createApp(COWORKER_AGENT_CONTEXT);

    const response = await app.request("http://localhost/x402");

    expect(response.status).toBe(200);
    expect(agentFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ jobCount: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      }),
    );
  });

  it("selects only the override columns the response actually reads", async () => {
    // `metadataOverride: true` loads every scalar on the override row; the
    // response resolves exactly three of them through the metadata getters,
    // and the cost is multiplied by the page size.
    const app = createApp(COWORKER_AGENT_CONTEXT);

    const response = await app.request("http://localhost/x402");

    expect(response.status).toBe(200);
    const query = agentFindManyMock.mock.calls[0]?.[0];
    expect(query.select.metadataOverride).toEqual({
      select: { name: true, description: true, image: true },
    });
  });
});
