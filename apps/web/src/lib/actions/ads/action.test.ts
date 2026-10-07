import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/middleware/auth-middleware", () => ({
  withSession:
    <TParams extends Record<string, unknown>, TResult>(
      handler: (params: TParams) => Promise<TResult>,
    ) =>
    async (params: TParams) =>
      handler(params),
}));

const adsServiceMock = {
  attachAccounts: vi.fn(),
  disconnectAccount: vi.fn(),
  finalizeConnection: vi.fn(),
  initiateConnection: vi.fn(),
  discardConnection: vi.fn(),
  updateCampaign: vi.fn(),
  createCampaign: vi.fn(),
};

// The real error mapper, so these tests see what the UI sees.
vi.mock("@/lib/clients/core.client", async () => {
  const { CoreApiRequestError, toCoreApiActionError } = await vi.importActual<
    typeof import("@/lib/clients/core.request")
  >("@/lib/clients/core.request");
  return { CoreApiRequestError, toCoreApiActionError };
});

vi.mock("@/lib/services/ads.service", () => ({ adsService: adsServiceMock }));

const ACCOUNT = {
  id: "account-1",
  connectionId: "connection-1",
  provider: "google_ads" as const,
  externalAccountId: "123-456-7890",
  name: "Launch plan",
  currency: "EUR",
  timeZone: null,
  loginCustomerId: null,
  createdAt: new Date("2026-10-01T10:00:00.000Z"),
};

async function coreError(message: string, status: number, kind?: string) {
  const { CoreApiRequestError } = await import("@/lib/clients/core.client");
  return new CoreApiRequestError(message, { status, kind });
}

describe("ads actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("initiateAdConnection", () => {
    it("hands the redirect back without revalidating", async () => {
      adsServiceMock.initiateConnection.mockResolvedValue({
        connectionId: "ca_1",
        redirectUrl: "https://connect.composio.dev/link",
      });

      const { initiateAdConnection } = await import("./action");
      const { revalidatePath } = await import("next/cache");
      const result = await initiateAdConnection({
        projectId: " project-1 ",
        provider: "google_ads",
      });

      expect(adsServiceMock.initiateConnection).toHaveBeenCalledWith(
        "project-1",
        "google_ads",
      );
      expect(result).toEqual({
        ok: true,
        value: {
          connectionId: "ca_1",
          redirectUrl: "https://connect.composio.dev/link",
        },
      });
      expect(revalidatePath).not.toHaveBeenCalled();
    });

    it("keeps the not-configured kind Core sent with its 503", async () => {
      adsServiceMock.initiateConnection.mockRejectedValue(
        await coreError(
          "Ads integrations are not configured on this server.",
          503,
          "integration_not_configured",
        ),
      );

      const { initiateAdConnection } = await import("./action");
      const result = await initiateAdConnection({
        projectId: "project-1",
        provider: "meta_ads",
      });

      expect(result).toMatchObject({
        ok: false,
        error: { kind: "integration_not_configured" },
      });
    });

    it("keeps other Core failures as ordinary action errors", async () => {
      adsServiceMock.initiateConnection.mockRejectedValue(
        await coreError("Bad gateway", 502),
      );

      const { initiateAdConnection } = await import("./action");
      const result = await initiateAdConnection({
        projectId: "project-1",
        provider: "meta_ads",
      });

      expect(result).toMatchObject({
        ok: false,
        error: { code: "INTERNAL_SERVER_ERROR", message: "Bad gateway" },
      });
      expect(result).not.toHaveProperty("error.kind");
    });

    it("rejects an unknown provider, calling nothing", async () => {
      const { initiateAdConnection } = await import("./action");
      const result = await initiateAdConnection({
        projectId: "project-1",
        provider: "tiktok_ads" as never,
      });

      expect(result).toMatchObject({ ok: false, error: { code: "BAD_INPUT" } });
      expect(adsServiceMock.initiateConnection).not.toHaveBeenCalled();
    });

    it("rejects a missing project, calling nothing", async () => {
      const { initiateAdConnection } = await import("./action");
      const result = await initiateAdConnection({
        projectId: " ",
        provider: "google_ads",
      });

      expect(result).toMatchObject({ ok: false, error: { code: "BAD_INPUT" } });
      expect(adsServiceMock.initiateConnection).not.toHaveBeenCalled();
    });
  });

  describe("finalizeAdConnection", () => {
    it("returns the connection and the accounts it can reach", async () => {
      const finalization = {
        connection: {
          id: "connection-1",
          provider: "google_ads" as const,
          status: "active" as const,
          createdAt: new Date("2026-10-01T10:00:00.000Z"),
        },
        availableAccounts: [
          {
            externalAccountId: "123-456-7890",
            name: "Launch plan",
            currency: "EUR",
            timeZone: null,
          },
        ],
      };
      adsServiceMock.finalizeConnection.mockResolvedValue(finalization);

      const { finalizeAdConnection } = await import("./action");
      const result = await finalizeAdConnection({
        projectId: "project-1",
        connectionId: " ca_1 ",
      });

      expect(adsServiceMock.finalizeConnection).toHaveBeenCalledWith(
        "project-1",
        "ca_1",
      );
      expect(result).toEqual({ ok: true, value: finalization });
    });

    it("surfaces a Core failure", async () => {
      adsServiceMock.finalizeConnection.mockRejectedValue(
        await coreError("Bad gateway", 502),
      );

      const { finalizeAdConnection } = await import("./action");
      const result = await finalizeAdConnection({
        projectId: "project-1",
        connectionId: "ca_1",
      });

      expect(result).toMatchObject({
        ok: false,
        error: { message: "Bad gateway" },
      });
    });
  });

  describe("attachAdAccounts", () => {
    it("attaches the chosen accounts and revalidates Ads", async () => {
      adsServiceMock.attachAccounts.mockResolvedValue([ACCOUNT]);

      const { attachAdAccounts } = await import("./action");
      const { revalidatePath } = await import("next/cache");
      const result = await attachAdAccounts({
        projectId: "project-1",
        adConnectionId: "connection-1",
        externalAccountIds: ["123-456-7890"],
      });

      expect(adsServiceMock.attachAccounts).toHaveBeenCalledWith(
        "project-1",
        "connection-1",
        ["123-456-7890"],
      );
      expect(result).toEqual({ ok: true, value: [ACCOUNT] });
      expect(revalidatePath).toHaveBeenCalledWith("/ads");
    });

    it("rejects blank account ids, calling nothing", async () => {
      const { attachAdAccounts } = await import("./action");
      const result = await attachAdAccounts({
        projectId: "project-1",
        adConnectionId: "connection-1",
        externalAccountIds: ["123", " "],
      });

      expect(result).toMatchObject({ ok: false, error: { code: "BAD_INPUT" } });
      expect(adsServiceMock.attachAccounts).not.toHaveBeenCalled();
    });

    it("rejects an empty choice, calling nothing", async () => {
      const { attachAdAccounts } = await import("./action");
      const result = await attachAdAccounts({
        projectId: "project-1",
        adConnectionId: "connection-1",
        externalAccountIds: [],
      });

      expect(result).toMatchObject({ ok: false, error: { code: "BAD_INPUT" } });
      expect(adsServiceMock.attachAccounts).not.toHaveBeenCalled();
    });

    it("does not revalidate when Core refuses", async () => {
      adsServiceMock.attachAccounts.mockRejectedValue(
        await coreError("Conflict", 409),
      );

      const { attachAdAccounts } = await import("./action");
      const { revalidatePath } = await import("next/cache");
      const result = await attachAdAccounts({
        projectId: "project-1",
        adConnectionId: "connection-1",
        externalAccountIds: ["123-456-7890"],
      });

      expect(result).toMatchObject({ ok: false });
      expect(revalidatePath).not.toHaveBeenCalled();
    });
  });

  describe("disconnectAdAccount", () => {
    it("disconnects the account and revalidates Ads", async () => {
      adsServiceMock.disconnectAccount.mockResolvedValue(undefined);

      const { disconnectAdAccount } = await import("./action");
      const { revalidatePath } = await import("next/cache");
      const result = await disconnectAdAccount({
        projectId: "project-1",
        accountId: " account-1 ",
      });

      expect(adsServiceMock.disconnectAccount).toHaveBeenCalledWith(
        "project-1",
        "account-1",
      );
      expect(result).toEqual({ ok: true, value: undefined });
      expect(revalidatePath).toHaveBeenCalledWith("/ads");
    });

    it("surfaces a Core failure without revalidating", async () => {
      adsServiceMock.disconnectAccount.mockRejectedValue(
        await coreError("Not found", 404),
      );

      const { disconnectAdAccount } = await import("./action");
      const { revalidatePath } = await import("next/cache");
      const result = await disconnectAdAccount({
        projectId: "project-1",
        accountId: "account-1",
      });

      expect(result).toMatchObject({ ok: false });
      expect(revalidatePath).not.toHaveBeenCalled();
    });
  });

  describe("discardAdConnection", () => {
    it("discards the connection without revalidating", async () => {
      adsServiceMock.discardConnection.mockResolvedValue(undefined);

      const { discardAdConnection } = await import("./action");
      const { revalidatePath } = await import("next/cache");
      const result = await discardAdConnection({
        projectId: "project-1",
        adConnectionId: " connection-1 ",
      });

      expect(adsServiceMock.discardConnection).toHaveBeenCalledWith(
        "project-1",
        "connection-1",
      );
      expect(result).toEqual({ ok: true, value: undefined });
      expect(revalidatePath).not.toHaveBeenCalled();
    });

    it("surfaces Core's refusal when the connection has accounts", async () => {
      adsServiceMock.discardConnection.mockRejectedValue(
        await coreError("Connection has ad accounts", 409),
      );

      const { discardAdConnection } = await import("./action");
      const result = await discardAdConnection({
        projectId: "project-1",
        adConnectionId: "connection-1",
      });

      expect(result).toMatchObject({ ok: false, error: { code: "BAD_INPUT" } });
    });

    it("rejects a missing connection id, calling nothing", async () => {
      const { discardAdConnection } = await import("./action");
      const result = await discardAdConnection({
        projectId: "project-1",
        adConnectionId: " ",
      });

      expect(result).toMatchObject({ ok: false, error: { code: "BAD_INPUT" } });
      expect(adsServiceMock.discardConnection).not.toHaveBeenCalled();
    });
  });

  describe("updateAdCampaign", () => {
    const base = {
      projectId: "project-1",
      accountId: "account-1",
      campaignId: " 42 ",
    };

    it("pauses a campaign and revalidates Ads", async () => {
      adsServiceMock.updateCampaign.mockResolvedValue(undefined);

      const { updateAdCampaign } = await import("./action");
      const { revalidatePath } = await import("next/cache");
      const result = await updateAdCampaign({ ...base, status: "PAUSED" });

      expect(adsServiceMock.updateCampaign).toHaveBeenCalledWith(
        "project-1",
        "account-1",
        "42",
        { status: "PAUSED" },
      );
      expect(result).toEqual({ ok: true, value: undefined });
      expect(revalidatePath).toHaveBeenCalledWith("/ads");
    });

    it("changes the daily budget", async () => {
      adsServiceMock.updateCampaign.mockResolvedValue(undefined);

      const { updateAdCampaign } = await import("./action");
      await updateAdCampaign({ ...base, dailyBudget: 25.5 });

      expect(adsServiceMock.updateCampaign).toHaveBeenCalledWith(
        "project-1",
        "account-1",
        "42",
        { dailyBudget: 25.5 },
      );
    });

    it.each([
      ["a zero budget", { dailyBudget: 0 }],
      ["a negative budget", { dailyBudget: -5 }],
      ["an unknown status", { status: "ENDED" }],
      ["no change at all", {}],
    ])("rejects %s, calling nothing", async (_name, changes) => {
      const { updateAdCampaign } = await import("./action");
      const { revalidatePath } = await import("next/cache");
      const result = await updateAdCampaign({
        ...base,
        ...changes,
      } as Parameters<typeof updateAdCampaign>[0]);

      expect(result).toMatchObject({ ok: false, error: { code: "BAD_INPUT" } });
      expect(adsServiceMock.updateCampaign).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    });

    it("tells the UI which status Core refused with, so it can word it", async () => {
      adsServiceMock.updateCampaign.mockRejectedValue(
        await coreError("Budget is shared with 2 other campaigns", 409),
      );

      const { updateAdCampaign } = await import("./action");
      const { revalidatePath } = await import("next/cache");
      const result = await updateAdCampaign({ ...base, dailyBudget: 10 });

      expect(result).toMatchObject({
        ok: false,
        error: { code: "BAD_INPUT", status: 409 },
      });
      expect(revalidatePath).not.toHaveBeenCalled();
    });
  });

  describe("createAdCampaign", () => {
    const base = {
      projectId: "project-1",
      accountId: "account-1",
      name: "  Spring sale ",
      dailyBudget: 25.5,
    };

    it("creates a campaign, trims the name and revalidates Ads", async () => {
      adsServiceMock.createCampaign.mockResolvedValue({ id: "42" });

      const { createAdCampaign } = await import("./action");
      const { revalidatePath } = await import("next/cache");
      const result = await createAdCampaign({
        ...base,
        objective: "OUTCOME_TRAFFIC",
      });

      expect(adsServiceMock.createCampaign).toHaveBeenCalledWith(
        "project-1",
        "account-1",
        {
          name: "Spring sale",
          dailyBudget: 25.5,
          objective: "OUTCOME_TRAFFIC",
        },
      );
      expect(result).toEqual({ ok: true, value: { id: "42" } });
      expect(revalidatePath).toHaveBeenCalledWith("/ads");
    });

    it("leaves the objective out when there is none", async () => {
      adsServiceMock.createCampaign.mockResolvedValue({ id: "42" });

      const { createAdCampaign } = await import("./action");
      await createAdCampaign(base);

      expect(adsServiceMock.createCampaign).toHaveBeenCalledWith(
        "project-1",
        "account-1",
        { name: "Spring sale", dailyBudget: 25.5 },
      );
    });

    it.each([
      ["a blank name", { name: "   " }],
      ["a name over 255 characters", { name: "a".repeat(256) }],
      ["a zero budget", { dailyBudget: 0 }],
    ])("rejects %s, calling nothing", async (_name, changes) => {
      const { createAdCampaign } = await import("./action");
      const { revalidatePath } = await import("next/cache");
      const result = await createAdCampaign({ ...base, ...changes });

      expect(result).toMatchObject({ ok: false, error: { code: "BAD_INPUT" } });
      expect(adsServiceMock.createCampaign).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    });

    it.each([409, 422])("tells the UI Core refused with %i", async (status) => {
      adsServiceMock.createCampaign.mockRejectedValue(
        await coreError("Core text", status),
      );

      const { createAdCampaign } = await import("./action");
      const { revalidatePath } = await import("next/cache");
      const result = await createAdCampaign(base);

      expect(result).toMatchObject({ ok: false, error: { status } });
      expect(revalidatePath).not.toHaveBeenCalled();
    });
  });
});
