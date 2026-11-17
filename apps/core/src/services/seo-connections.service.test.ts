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
  rowUpdate: vi.fn(),
  upsert: vi.fn(),
  identity: vi.fn(),
  revoke: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    workspace: { findFirst: m.workspace },
    seoConnection: {
      findUnique: m.selection,
      updateMany: m.rowUpdate,
      upsert: m.upsert,
    },
    seoConnectionIntent: {
      findUnique: m.intent,
      findFirst: async () => null,
      findMany: async () => [],
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
  deleteProjectSocialConnectionIntent: m.revoke,
}));
vi.mock("@/lib/db/transaction", async () => {
  const prisma = (await import("@/lib/db/prisma")).default;
  return {
    serializableTransaction: (run: (tx: unknown) => unknown) => run(prisma),
  };
});
vi.mock("@/lib/seo/google-account-identity", () => ({
  readGoogleAccountIdentity: m.identity,
}));

import { readIntegrationTool } from "@/services/composio-integration-tools.service";
import {
  completeSeoConnectionCallback,
  connectSeoConnection,
  disconnectSeoConnection,
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
  it("returns a stable opaque version that changes when native consent is replaced", async () => {
    const selected = {
      id: "native-selection",
      status: "ACTIVE",
      composioAccountId: "ca-native",
      entityId: identity,
      revision: 2,
    };
    m.selection.mockResolvedValue(selected);
    const first = await getSeoConnection(owner, "ga4");
    expect(first.connectionVersion).toMatch(/^[a-f0-9]{64}$/);
    expect((await getSeoConnection(owner, "ga4")).connectionVersion).toBe(
      first.connectionVersion,
    );
    selected.revision++;
    expect((await getSeoConnection(owner, "ga4")).connectionVersion).not.toBe(
      first.connectionVersion,
    );
  });

  it("changes the inherited consent version after the same account is reconnected", async () => {
    const inherited = {
      composioAccountId: "ca-personal",
      sokoBotId: "existing-bot",
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    };
    m.selection.mockResolvedValue(null);
    m.legacy.mockResolvedValue([inherited]);
    const first = await getSeoConnection(owner, "ga4");
    expect(first.connectionVersion).toMatch(/^[a-f0-9]{64}$/);
    inherited.updatedAt = new Date("2026-01-02T00:00:00Z");
    expect((await getSeoConnection(owner, "ga4")).connectionVersion).not.toBe(
      first.connectionVersion,
    );
  });
  it("uses an explicit native account without needing or creating a bot", async () => {
    m.selection.mockResolvedValue({
      status: "ACTIVE",
      id: "native-selection",
      revision: 2,
      composioAccountId: "ca-native",
      entityId: identity,
    });
    const integration = await resolveSeoStatisticsIntegration(owner, "ga4");
    expect(integration).toMatchObject({
      composioAccountId: "ca-native",
      entityId: identity,
      connectionRevision: "native:native-selection:2",
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
      {
        composioAccountId: "ca-personal",
        sokoBotId: "existing-bot",
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      },
    ]);
    expect(
      await resolveSeoStatisticsIntegration(owner, "search_console"),
    ).toMatchObject({
      composioAccountId: "ca-personal",
      entityId: "sokobot:existing-bot",
      connectionRevision: "personal:2026-01-01T00:00:00.000Z",
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

describe("Google account identity on a native connection", () => {
  type Row = Record<string, unknown>;
  const google = {
    email: "ann@example.com",
    name: "Ann",
    pictureUrl: "https://lh3.googleusercontent.com/a/ann",
  };
  /** Applies a Prisma-style where/data pair to one in-memory row. */
  function fakeRow(initial: Row) {
    const row: Row = { ...initial };
    const matches = (where: Row): boolean =>
      Object.entries(where).every(([key, value]) => {
        if (key === "OR") return (value as Row[]).some(matches);
        if (
          value instanceof Date ||
          value === null ||
          typeof value !== "object"
        )
          return row[key] === value;
        const { lt } = value as { lt?: Date };
        // Other operators (revision filters) stay out of these cases.
        return lt === undefined || (row[key] as Date) < lt;
      });
    m.selection.mockImplementation(async () => ({ ...row }));
    m.rowUpdate.mockImplementation(
      async ({ where, data }: { where: Row; data: Row }) => {
        if (!matches(where)) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
    );
    m.upsert.mockImplementation(async ({ update }: { update: Row }) => {
      const before = { ...row };
      Object.assign(row, update, { revision: Number(row.revision) + 1 });
      return before;
    });
    return row;
  }
  const active = {
    ...owner,
    provider: "ga4",
    id: "native-selection",
    status: "ACTIVE",
    revision: 2,
    composioAccountId: "ca-old",
    entityId: identity,
  };
  beforeEach(() => m.revoke.mockResolvedValue(undefined));

  it("reads a pre-existing connection's identity once, also when Google returns none", async () => {
    fakeRow({ ...active, accountCheckedAt: null, accountEmail: null });
    m.identity.mockResolvedValue(null);
    expect((await getSeoConnection(owner, "ga4")).account).toBeNull();
    expect((await getSeoConnection(owner, "ga4")).account).toBeNull();
    expect(m.identity).toHaveBeenCalledTimes(1);
  });

  it("reads again after the retry period when the last read gave no identity", async () => {
    const hoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    fakeRow({ ...active, accountCheckedAt: hoursAgo, accountEmail: null });
    m.identity.mockResolvedValue(google);
    expect((await getSeoConnection(owner, "ga4")).account).toEqual(google);
  });

  it("keeps the identity in a finalize answer when a status read runs during the old account cleanup", async () => {
    fakeRow({ ...active, accountCheckedAt: new Date(), accountEmail: null });
    m.intent.mockResolvedValue({ ...intent(), callbackRedeemedAt: new Date() });
    let release = (_: typeof google) => {};
    m.identity.mockImplementation(
      () => new Promise<typeof google>((resolve) => (release = resolve)),
    );
    // The cleanup of the old account waits on Composio; a status read starts meanwhile.
    m.revoke.mockImplementation(async () => {
      void getSeoConnection(owner, "ga4");
      await Promise.resolve();
    });
    const finalized = finalizeSeoConnection(owner, "ga4", "ca-google");
    await vi.waitFor(() => expect(m.identity).toHaveBeenCalled());
    release(google);
    expect(await finalized).toMatchObject({ account: google });
  });

  it("answers a finalize with the identity when a status read starts as the account changes", async () => {
    const row = fakeRow({
      ...active,
      accountCheckedAt: null,
      accountEmail: null,
    });
    m.intent.mockResolvedValue({ ...intent(), callbackRedeemedAt: new Date() });
    m.identity.mockResolvedValue(google);
    const reads: Promise<unknown>[] = [];
    const update = m.rowUpdate.getMockImplementation()!;
    m.rowUpdate.mockImplementation(async (args: { data: Row }) => {
      const result = await update(args);
      // The popup closes and the opener's focus reads the status right after the switch.
      if (args.data.composioAccountId === "ca-google")
        reads.push(getSeoConnection(owner, "ga4"));
      return result;
    });
    expect(
      await finalizeSeoConnection(owner, "ga4", "ca-google"),
    ).toMatchObject({ account: google });
    await Promise.all(reads);
    expect(m.identity).toHaveBeenCalledTimes(1);
    expect(row.accountEmail).toBe(google.email);
  });

  it("lets only one of two concurrent status reads call Google", async () => {
    fakeRow({ ...active, accountCheckedAt: null, accountEmail: null });
    m.identity.mockResolvedValue(google);
    const reads = await Promise.all([
      getSeoConnection(owner, "ga4"),
      getSeoConnection(owner, "ga4"),
    ]);
    expect(m.identity).toHaveBeenCalledTimes(1);
    expect(reads.map((read) => read.account)).toContainEqual(google);
    expect((await getSeoConnection(owner, "ga4")).account).toEqual(google);
  });

  it("stores the new account's identity when a connection is finalized", async () => {
    fakeRow({ ...active, accountCheckedAt: new Date(), accountEmail: null });
    m.intent.mockResolvedValue({ ...intent(), callbackRedeemedAt: new Date() });
    m.identity.mockResolvedValue(google);
    expect(
      await finalizeSeoConnection(owner, "ga4", "ca-google"),
    ).toMatchObject({ status: "connected", account: google });
    expect(m.identity).toHaveBeenCalledWith({
      connectedAccountId: "ca-google",
      executorUserId: identity,
    });
  });

  it("finalizes without the old account's identity when the new read fails", async () => {
    const row = fakeRow({
      ...active,
      accountCheckedAt: new Date(),
      accountEmail: "old@example.com",
      accountName: "Old",
      accountPictureUrl: null,
    });
    m.intent.mockResolvedValue({ ...intent(), callbackRedeemedAt: new Date() });
    m.identity.mockRejectedValue(new Error("Google is down"));
    expect(
      await finalizeSeoConnection(owner, "ga4", "ca-google"),
    ).toMatchObject({ status: "connected", account: null });
    expect(row).toMatchObject({
      composioAccountId: "ca-google",
      accountEmail: null,
      accountName: null,
    });
  });

  it("clears the stored identity on disconnect", async () => {
    const row = fakeRow({
      ...active,
      accountCheckedAt: new Date(),
      accountEmail: "old@example.com",
      accountName: "Old",
      accountPictureUrl: google.pictureUrl,
    });
    await disconnectSeoConnection(owner, "ga4");
    expect(row).toMatchObject({
      status: "DISCONNECTED",
      accountEmail: null,
      accountName: null,
      accountPictureUrl: null,
      accountCheckedAt: null,
    });
  });
});
