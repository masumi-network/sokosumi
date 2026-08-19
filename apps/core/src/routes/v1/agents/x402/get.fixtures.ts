/**
 * Shared fixtures for the `GET /v1/agents/x402` suites, split by concern into
 * `get.test.ts` (authorization, the fail-closed per-agent gates, and drop
 * logging) and `get.query.test.ts` (the shape of the catalog query itself —
 * pagination, ordering, snapshot isolation, column narrowing).
 *
 * Only the vitest mock objects stay per-file: a `vi.mock` factory may close
 * over `vi.hoisted` bindings declared in the SAME file, so each suite declares
 * its own and feeds them from the plain row builders here.
 *
 * Deliberately not named `*.test.ts`: vitest's `include` collects only that
 * suffix, and this module holds no tests of its own.
 */
import { OpenAPIHono } from "@hono/zod-openapi";

import { formatZodErrorMessage, unprocessableEntity } from "@/helpers/error";
import { X402_BUY_SIDE_READINESS_KEY } from "@/helpers/x402-readiness";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type {
  AuthVariables,
  CoworkerAuthenticationContext,
} from "@/middleware/auth";

import mountGetX402Agents from "./get";

export const BASE_SEPOLIA = "eip155:84532";
export const BASE_MAINNET = "eip155:8453";
export const USDC_ADDRESS = "0x036cbd53842c5426634e7929541ec2318f3dcf7e";
export const UNPRICED_ADDRESS = "0x2222222222222222222222222222222222222222";
export const PAY_TO = "0x1111111111111111111111111111111111111111";
export const EVM_WALLET_ADDRESS = "0x3333333333333333333333333333333333333333";

/**
 * Typed as the coworker member, not the whole `AuthenticationContext` union:
 * the delegated-coworker case spreads this and adds `context`, which only
 * that member declares. In-file, a `const` annotated with the union narrows
 * back to the initializer's member by control flow and the spread compiles;
 * across a module boundary the importer sees the declared union and the added
 * property is an excess property against `UserAuthenticationContext`.
 */
export const COWORKER_AGENT_CONTEXT: CoworkerAuthenticationContext = {
  actor: "coworker",
  coworkerId: "coworker_1",
  vendorId: "vendor_1",
};

export function createApp(authContext: AuthVariables["authContext"]) {
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

/**
 * The node's published scale for the test assets, as the readiness cache
 * carries it. Seeded pairs default to it — `getX402ReadySources` drops a pair
 * whose `decimals` is missing or unusable — so a fixture only spells the field
 * out when the point of the test is the node/registry split.
 */
export const NODE_DECIMALS = 6;

export interface ReadinessPairFixture {
  caip2Network: string;
  asset: string;
  evmWalletId: string;
  evmWalletAddress?: string;
  decimals?: number;
}

/** The `syncMetadata` row `getX402ReadySources` parses its pairs out of. */
export function createReadinessRow(pairs: ReadinessPairFixture[]) {
  return {
    key: X402_BUY_SIDE_READINESS_KEY,
    cursorId: JSON.stringify(
      pairs.map((pair) => ({
        decimals: NODE_DECIMALS,
        evmWalletAddress: EVM_WALLET_ADDRESS,
        ...pair,
      })),
    ),
    lastSyncedAt: new Date(),
  };
}

export function createCreditCostRow(unit: string, centsPerUnit: bigint) {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    id: `credit-cost-${unit}`,
    createdAt: now,
    updatedAt: now,
    unit,
    centsPerUnit,
  };
}

export interface AgentRowOverrides {
  id?: string;
  type?: "X402" | "OPEN_API";
  x402ResourcesUrl?: string | null;
  openApiSpecUrl?: string | null;
  metadataOverride?: {
    name: string | null;
    description: string | null;
    image: string | null;
  } | null;
  paymentSources?: unknown[];
}

export function createAgentRow(overrides: AgentRowOverrides = {}) {
  const type = overrides.type ?? "X402";
  return {
    id: overrides.id ?? "agent_x402_1",
    type,
    name: "Registry Name",
    description: "Registry description",
    image: "https://registry.example.com/image.png",
    x402ResourcesUrl:
      overrides.x402ResourcesUrl !== undefined
        ? overrides.x402ResourcesUrl
        : type === "X402"
          ? "https://agent.example.com/.well-known/x402"
          : null,
    openApiSpecUrl:
      overrides.openApiSpecUrl !== undefined
        ? overrides.openApiSpecUrl
        : type === "OPEN_API"
          ? "https://agent.example.com/openapi.json"
          : null,
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
