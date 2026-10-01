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
};

class CoreApiRequestError extends Error {
  status?: number;

  constructor(message: string, options?: { status?: number }) {
    super(message);
    this.name = "CoreApiRequestError";
    this.status = options?.status;
  }
}

vi.mock("@/lib/clients/core.client", () => ({
  CoreApiRequestError,
  toCoreApiActionError: (error: unknown) => ({
    code: "INTERNAL_SERVER_ERROR",
    message: error instanceof Error ? error.message : "unknown",
  }),
}));

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

    it("maps Core's 503 to a not-configured error", async () => {
      adsServiceMock.initiateConnection.mockRejectedValue(
        new CoreApiRequestError("Ads integrations are not configured.", {
          status: 503,
        }),
      );

      const { initiateAdConnection } = await import("./action");
      const result = await initiateAdConnection({
        projectId: "project-1",
        provider: "meta_ads",
      });

      expect(result).toMatchObject({
        ok: false,
        error: { code: "ADS_NOT_CONFIGURED" },
      });
    });

    it("keeps other Core failures as ordinary action errors", async () => {
      adsServiceMock.initiateConnection.mockRejectedValue(
        new CoreApiRequestError("Bad gateway", { status: 502 }),
      );

      const { initiateAdConnection } = await import("./action");
      const result = await initiateAdConnection({
        projectId: "project-1",
        provider: "meta_ads",
      });

      expect(result).toMatchObject({
        ok: false,
        error: { code: "INTERNAL_SERVER_ERROR" },
      });
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
        new CoreApiRequestError("Bad gateway", { status: 502 }),
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
        new CoreApiRequestError("Conflict", { status: 409 }),
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
        new CoreApiRequestError("Not found", { status: 404 }),
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
});
