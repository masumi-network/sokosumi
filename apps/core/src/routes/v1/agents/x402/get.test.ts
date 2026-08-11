import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { formatZodErrorMessage, unprocessableEntity } from "@/helpers/error";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountGetX402Agents from "./get";

const {
  agentFindManyMock,
  creditCostFindManyMock,
  syncMetadataFindUniqueMock,
} = vi.hoisted(() => ({
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
    agent: { findMany: agentFindManyMock },
    creditCost: { findMany: creditCostFindManyMock },
    syncMetadata: { findUnique: syncMetadataFindUniqueMock },
  },
}));

const BASE_SEPOLIA = "eip155:84532";
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

  it("drops an agent advertising a network outside the per-env allowlist", async () => {
    // Base mainnet is disallowed on Preprod even when priced and ready.
    agentFindManyMock.mockResolvedValue([
      createAgentRow({
        id: "agent_x402_mainnet",
        paymentSources: [
          {
            sourceIndex: 0,
            network: "eip155:8453",
            payTo: PAY_TO,
            pricingType: "FIXED",
            amounts: [{ unit: USDC_ADDRESS, amount: 250000n, decimals: 6 }],
          },
        ],
      }),
    ]);
    creditCostFindManyMock.mockResolvedValue([
      createCreditCostRow(`eip155:8453/erc20:${USDC_ADDRESS}`, 2n * 10n ** 10n),
    ]);
    seedReadiness([
      {
        caip2Network: "eip155:8453",
        asset: USDC_ADDRESS,
        evmWalletId: "wallet-1",
      },
    ]);
    const app = createApp(COWORKER_AGENT_CONTEXT);

    const response = await app.request("http://localhost/x402");

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: unknown };
    expect(body.data).toEqual([]);
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
