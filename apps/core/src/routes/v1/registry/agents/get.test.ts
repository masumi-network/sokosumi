import type { RegistryEntry } from "@sokosumi/masumi";
import { err, ok } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler.js";
import { OpenAPIHonoWithAuth } from "@/lib/hono.js";
import type { AuthenticationContext } from "@/middleware/auth";
import { expectCoreLogWhys } from "@/test/core-log";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const { listEntriesMock } = vi.hoisted(() => ({ listEntriesMock: vi.fn() }));

vi.mock("@/clients/masumi-registry.client", () => ({
  registryClient: { listEntries: listEntriesMock },
}));

const { incrementMock } = vi.hoisted(() => ({ incrementMock: vi.fn() }));

vi.mock("@/lib/redis-rate-limit", () => ({
  incrementRedisRateLimit: incrementMock,
}));

const { default: registryAgentsRouter, REGISTRY_READS_PER_MINUTE } =
  await import("./index.js");

const USER_API_KEY: AuthenticationContext = {
  actor: "user",
  userId: "user_1",
  organizationId: null,
  role: "user",
  authenticationMethod: "api_key",
};

function createApp(authContext: AuthenticationContext = USER_API_KEY) {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("requestId", "req_registry_test");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    await next();
  });
  app.route("/", registryAgentsRouter);
  app.onError(errorHandler);
  return app;
}

function entry(id: string, overrides: Partial<RegistryEntry> = {}) {
  return {
    id,
    name: `Agent ${id}`,
    createdAt: new Date("2026-11-01T00:00:00.000Z"),
    description: null,
    status: "Online",
    statusUpdatedAt: new Date("2026-11-02T00:00:00.000Z"),
    lastUptimeCheck: new Date("2026-11-03T00:00:00.000Z"),
    uptimeCount: 9,
    uptimeCheckCount: 10,
    type: "Standard",
    apiBaseUrl: "https://agent.example.com",
    openApiSpecUrl: null,
    x402ResourcesUrl: null,
    authorName: "Ada",
    authorOrganization: null,
    authorContactEmail: null,
    authorContactOther: null,
    image: null,
    privacyPolicy: null,
    termsAndCondition: null,
    otherLegal: null,
    tags: null,
    agentIdentifier: `asset_${id}`,
    supersedesAgentIdentifier: null,
    supersededByAgentIdentifier: null,
    paymentType: "Web3CardanoV1",
    RegistrySource: { id: "src_1", policyId: "policy_1", url: null },
    Capability: null,
    AgentPricing: { pricingType: "Free" },
    ExampleOutput: [],
    SupportedPaymentSources: [],
    ...overrides,
  } as RegistryEntry;
}

describe("GET /registry/agents", () => {
  beforeEach(() => {
    listEntriesMock.mockReset();
    listEntriesMock.mockResolvedValue(ok([entry("a")]));
    incrementMock.mockReset();
    incrementMock.mockResolvedValue(1);
  });

  it.each<[string, AuthenticationContext]>([
    ["a session", { ...USER_API_KEY, authenticationMethod: "session" }],
    ["an OAuth token", { ...USER_API_KEY, authenticationMethod: "oauth" }],
    [
      "a Soko Bot key",
      {
        actor: "sokoBot",
        sokoBotId: "bot_1",
        workspaceId: "ws_1",
        scope: "workspace",
        userId: null,
        organizationId: "org_1",
        projectId: null,
      },
    ],
  ])("refuses %s with 403 before calling the registry", async (_, auth) => {
    const response = await createApp(auth).request("/");

    expect(response.status).toBe(403);
    expect(listEntriesMock).not.toHaveBeenCalled();
  });

  it.each<[string, AuthenticationContext]>([
    ["a user API key", USER_API_KEY],
    [
      "a Coworker key",
      { actor: "coworker", coworkerId: "cow_1", vendorId: "vendor_1" },
    ],
  ])("serves %s", async (_, auth) => {
    const response = await createApp(auth).request("/");

    expect(response.status).toBe(200);
  });

  it("asks the registry for every status when the caller sends none", async () => {
    await createApp().request("/");

    expect(listEntriesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: ["Online", "Offline", "Deregistered", "Invalid"],
      }),
      expect.anything(),
    );
  });

  it("serves an A2A agent next to a standard one", async () => {
    listEntriesMock.mockResolvedValue(
      ok([
        entry("a2a", { type: "A2A" } as unknown as Partial<RegistryEntry>),
        entry("std"),
      ]),
    );

    const response = await createApp().request("/");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.map((agent: { type: string }) => agent.type)).toEqual([
      "A2A",
      "Standard",
    ]);
  });

  it("drops the repeated cursor row and returns the next cursor", async () => {
    listEntriesMock.mockResolvedValue(
      ok([entry("c0"), entry("c1"), entry("c2"), entry("c3")]),
    );

    const response = await createApp().request(
      "/?cursor=c0&limit=2&status=Online,Deregistered",
    );
    const body = await response.json();

    expect(listEntriesMock).toHaveBeenCalledWith(
      { cursorId: "c0", limit: 4, status: ["Online", "Deregistered"] },
      expect.anything(),
    );
    expect(body.data.map((agent: { id: string }) => agent.id)).toEqual([
      "c1",
      "c2",
    ]);
    expect(body.meta.pagination).toEqual({
      cursor: "c0",
      limit: 2,
      nextCursor: "c2",
    });
  });

  it("ends the listing when no row is left past the page", async () => {
    listEntriesMock.mockResolvedValue(ok([entry("c0"), entry("c1")]));

    const response = await createApp().request("/?cursor=c0&limit=2");
    const body = await response.json();

    expect(body.data).toHaveLength(1);
    expect(body.meta.pagination.nextCursor).toBeNull();
  });

  it("maps fixed pricing and nulls a pricing shape it does not know", async () => {
    listEntriesMock.mockResolvedValue(
      ok([
        entry("fixed", {
          AgentPricing: {
            pricingType: "Fixed",
            FixedPricing: { Amounts: [{ amount: "5000000", unit: "" }] },
          },
        }),
        entry("odd", { AgentPricing: { pricingType: "Subscription" } }),
      ]),
    );

    const body = await (await createApp().request("/")).json();

    expect(body.data[0].pricing).toEqual({
      pricingType: "Fixed",
      amounts: [{ amount: "5000000", unit: "" }],
    });
    expect(body.data[1].pricing).toBeNull();
  });

  it("answers 502 without the registry's error text", async () => {
    listEntriesMock.mockResolvedValue(err("token=secret upstream failure"));
    expectCoreLogWhys(
      "warn",
      "Masumi registry request failed",
      ["The registry did not return a page of entries"],
      ["token=secret upstream failure"],
    );

    const response = await createApp().request("/");
    const text = await response.text();

    expect(response.status).toBe(502);
    expect(text).not.toContain("secret");
  });

  it("rejects a limit the registry page cannot hold", async () => {
    const response = await createApp().request("/?limit=49");

    expect(response.status).toBe(422);
    expect(listEntriesMock).not.toHaveBeenCalled();
  });

  it.each<[string, AuthenticationContext, string]>([
    ["a user", USER_API_KEY, "registry:agents-read:user:user_1"],
    [
      "a Coworker",
      { actor: "coworker", coworkerId: "cow_1", vendorId: "vendor_1" },
      "registry:agents-read:coworker:cow_1",
    ],
  ])(
    "answers 429 once %s has used the minute's budget",
    async (_, auth, key) => {
      incrementMock.mockResolvedValue(REGISTRY_READS_PER_MINUTE + 1);

      const response = await createApp(auth).request("/");

      expect(incrementMock).toHaveBeenCalledWith(key, 60);
      expect(response.status).toBe(429);
      expect(response.headers.get("Retry-After")).toBe("60");
      expect(listEntriesMock).not.toHaveBeenCalled();
    },
  );

  it("serves the last read inside the budget", async () => {
    incrementMock.mockResolvedValue(REGISTRY_READS_PER_MINUTE);

    const response = await createApp().request("/");

    expect(response.status).toBe(200);
  });
});
