import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  intent: vi.fn(),
  selection: vi.fn(),
  legacy: vi.fn(),
  workspace: vi.fn(),
  redeemed: vi.fn(),
  complete: vi.fn(),
  account: vi.fn(),
  fetch: vi.fn(),
  describe: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    workspace: { findFirst: m.workspace },
    seoConnection: { findUnique: m.selection },
    seoConnectionIntent: {
      findUnique: m.intent,
      findFirst: async () => null,
      updateMany: m.redeemed,
    },
    sokoBotIntegration: { findMany: m.legacy },
  },
}));
vi.mock("@/config/env", () => ({
  getEnv: () => ({
    NODE_ENV: "production",
    COMPOSIO_API_KEY: "test-only",
    COMPOSIO_API_BASE_URL: "https://composio.invalid",
  }),
}));
vi.mock("@/clients/composio.client", () => ({
  getComposio: () => ({ tools: { getRawComposioToolBySlug: m.describe } }),
  completeComposioAuth: m.complete,
  getComposioConnectedAccount: m.account,
}));

import { readIntegrationTool } from "@/services/composio-integration-tools.service";
import {
  completeSeoConnectionCallback,
  connectSeoConnection,
  finalizeSeoConnection,
} from "@/services/seo-connection-oauth.service";
import {
  getSeoConnection,
  resolveSeoStatisticsIntegration,
} from "@/services/seo-connections.service";

const owner = { userId: "alice", workspaceId: "workspace-a" };
const identity = "sokosumi:seo:workspace-a:alice";
const intent = () => ({
  ...owner,
  connectionId: "ca-google",
  provider: "ga4",
  toolkit: "google_analytics",
  authConfigId: "ac-google",
  connectorEntityId: identity,
  executorEntityId: identity,
  expectedRevision: 2,
  callbackRedeemedAt: null,
  finalizedAt: null,
  expiresAt: new Date(Date.now() + 60_000),
});
beforeEach(() => {
  vi.resetAllMocks();
  m.workspace.mockResolvedValue({ organizationId: null });
  m.selection.mockResolvedValue({ revision: 2, status: "INHERIT" });
  m.legacy.mockResolvedValue([]);
  m.intent.mockImplementation(async () => intent());
  m.complete.mockResolvedValue({
    connectedAccountId: "ca-google",
    toolkitSlug: "google_analytics",
  });
  m.account.mockResolvedValue({
    id: "ca-google",
    toolkitSlug: "google_analytics",
    authConfigId: "ac-google",
    connectorUserId: identity,
    status: "ACTIVE",
  });
  m.redeemed.mockResolvedValue({ count: 1 });
  vi.stubGlobal("fetch", m.fetch);
});
afterEach(() => vi.unstubAllGlobals());

describe("native SEO connection ownership", () => {
  it("uses an explicit native account without needing or creating a bot", async () => {
    m.selection.mockResolvedValue({
      status: "ACTIVE",
      composioAccountId: "ca-native",
      entityId: identity,
    });
    const integration = await resolveSeoStatisticsIntegration(owner, "ga4");
    expect(integration).toMatchObject({
      composioAccountId: "ca-native",
      entityId: identity,
    });
    expect(m.legacy).not.toHaveBeenCalled();
    expect(m.complete).not.toHaveBeenCalled();
    expect(await getSeoConnection(owner, "ga4")).toMatchObject({
      status: "connected",
      source: "native",
    });
  });

  it("retains the actual legacy account execution identity when reusing consent", async () => {
    m.selection.mockResolvedValue(null);
    m.legacy.mockResolvedValue([
      { composioAccountId: "ca-personal", sokoBotId: "existing-bot" },
    ]);
    expect(
      await resolveSeoStatisticsIntegration(owner, "search_console"),
    ).toMatchObject({
      composioAccountId: "ca-personal",
      entityId: "sokobot:existing-bot",
    });
    expect(m.legacy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "ACTIVE",
          provider: "google_search_console",
          sokoBot: expect.objectContaining({
            userId: "alice",
            workspaceId: "workspace-a",
            projectId: null,
          }),
        }),
      }),
    );
  });

  it("does not silently reactivate personal consent after SEO disconnect", async () => {
    m.selection.mockResolvedValue({ status: "DISCONNECTED" });
    expect(await resolveSeoStatisticsIntegration(owner, "ga4")).toBeNull();
    expect(m.legacy).not.toHaveBeenCalled();
  });

  it("refuses removed workspace membership before reading account data", async () => {
    m.workspace.mockResolvedValue(null);
    await expect(
      resolveSeoStatisticsIntegration(owner, "ga4"),
    ).rejects.toMatchObject({ status: 404 });
    expect(m.selection).not.toHaveBeenCalled();
  });

  it.each([
    { userId: "bob" },
    { expiresAt: new Date(0) },
    { connectorEntityId: "other-identity" },
    { executorEntityId: "other-identity" },
  ])(
    "refuses an unowned, expired, or substituted callback before external redemption: %o",
    async (change) => {
      m.intent.mockResolvedValue({ ...intent(), ...change });
      await expect(
        completeSeoConnectionCallback({
          connectionId: "ca-google",
          userId: "alice",
          sessionUri: "one-use",
        }),
      ).rejects.toMatchObject({ status: 404 });
      expect(m.complete).not.toHaveBeenCalled();
    },
  );

  it("refuses a superseded OAuth attempt before redemption", async () => {
    m.selection.mockResolvedValue({ revision: 3 });
    await expect(
      completeSeoConnectionCallback({
        connectionId: "ca-google",
        userId: "alice",
        sessionUri: "one-use",
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(m.complete).not.toHaveBeenCalled();
  });

  it.each([
    "https://other.example/composio/callback",
    "https://preprod.sokosumi.com/some-other-page",
    "https://alice:password@preprod.sokosumi.com/composio/callback",
  ])(
    "refuses an untrusted callback before starting consent: %s",
    async (callback) => {
      await expect(
        connectSeoConnection(owner, "ga4", callback),
      ).rejects.toMatchObject({ status: 422 });
      expect(m.fetch).not.toHaveBeenCalled();
    },
  );

  it.each([
    { id: "ca-other" },
    { toolkitSlug: "gmail" },
    { authConfigId: "ac-other" },
    { connectorUserId: "bob" },
  ])(
    "does not accept substituted provider metadata after one-use redemption: %o",
    async (change) => {
      m.account.mockResolvedValue({
        id: "ca-google",
        toolkitSlug: "google_analytics",
        authConfigId: "ac-google",
        connectorUserId: identity,
        status: "ACTIVE",
        ...change,
      });
      await expect(
        completeSeoConnectionCallback({
          connectionId: "ca-google",
          userId: "alice",
          sessionUri: "one-use",
        }),
      ).rejects.toMatchObject({ status: 404 });
      expect(m.redeemed).toHaveBeenCalledTimes(1);
    },
  );

  it("binds finalize to the current workspace and provider", async () => {
    await expect(
      finalizeSeoConnection(
        { ...owner, workspaceId: "workspace-b" },
        "ga4",
        "ca-google",
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      finalizeSeoConnection(owner, "search_console", "ca-google"),
    ).rejects.toMatchObject({ status: 404 });
    expect(m.account).not.toHaveBeenCalled();
  });

  it("makes a completed finalize idempotent without another provider mutation", async () => {
    m.intent.mockResolvedValue({ ...intent(), finalizedAt: new Date() });
    m.selection.mockResolvedValue({
      revision: 2,
      status: "ACTIVE",
      composioAccountId: "ca-google",
      entityId: identity,
    });
    expect(
      await finalizeSeoConnection(owner, "ga4", "ca-google"),
    ).toMatchObject({ status: "connected", source: "native" });
    expect(m.account).not.toHaveBeenCalled();
    expect(m.redeemed).not.toHaveBeenCalled();
  });

  it("redeems one matching callback with an atomic one-use claim", async () => {
    expect(
      await completeSeoConnectionCallback({
        connectionId: "ca-google",
        userId: "alice",
        sessionUri: "one-use",
      }),
    ).toBe(true);
    expect(m.complete).toHaveBeenCalledWith({
      sessionUri: "one-use",
      userId: identity,
    });
    expect(m.redeemed).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "alice",
          callbackRedeemedAt: null,
          finalizedAt: null,
        }),
      }),
    );
    m.redeemed.mockResolvedValue({ count: 0 });
    await expect(
      completeSeoConnectionCallback({
        connectionId: "ca-google",
        userId: "alice",
        sessionUri: "another",
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("executes a read-only provider tool under its real native entity", async () => {
    m.selection.mockResolvedValue({
      status: "ACTIVE",
      composioAccountId: "ca-native",
      entityId: identity,
    });
    m.describe.mockResolvedValue({ tags: ["readOnlyHint"] });
    m.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({ successful: true, data: { accountSummaries: [] } }),
        { status: 200 },
      ),
    );
    const account = await resolveSeoStatisticsIntegration(owner, "ga4");
    if (!account) throw new Error("Missing test account");
    await readIntegrationTool(
      account,
      "GOOGLE_ANALYTICS_LIST_ACCOUNT_SUMMARIES",
      {},
    );
    const body = JSON.parse(m.fetch.mock.calls[0]![1].body);
    expect(body).toMatchObject({
      user_id: identity,
      connected_account_id: "ca-native",
    });
  });
});
