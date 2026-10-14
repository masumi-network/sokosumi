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
  editCampaign: vi.fn(),
  listMarketKeywords: vi.fn(),
  searchLocations: vi.fn(),
  saveMarketProfile: vi.fn(),
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
      expect(revalidatePath).toHaveBeenCalledWith("/ads/campaigns/42");
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

    const google = {
      type: "SEARCH" as const,
      locationIds: [],
      languageIds: [],
      finalUrl: "https://example.com",
      keywords: [{ text: "running shoes", matchType: "BROAD" as const }],
      headlines: ["One", "Two", "Three"],
      descriptions: ["First description", "Second description"],
    };

    it("passes the Google spec to Core, without an objective", async () => {
      adsServiceMock.createCampaign.mockResolvedValue({ id: "42" });

      const { createAdCampaign } = await import("./action");
      const result = await createAdCampaign({ ...base, google });

      expect(adsServiceMock.createCampaign).toHaveBeenCalledWith(
        "project-1",
        "account-1",
        { name: "Spring sale", dailyBudget: 25.5, google },
      );
      expect(result).toEqual({ ok: true, value: { id: "42" } });
    });

    it.each([
      ["a blank name", { name: "   " }],
      [
        "a Google spec without keywords",
        { google: { ...google, keywords: [] } },
      ],
      [
        "a Google spec with two headlines",
        { google: { ...google, headlines: ["One", "Two"] } },
      ],
      ["a name over 255 characters", { name: "a".repeat(256) }],
      ["a zero budget", { dailyBudget: 0 }],
      [
        "a keyword of 11 words",
        {
          google: {
            ...google,
            keywords: [
              {
                text: "one two three four five six seven eight nine ten eleven",
                matchType: "BROAD" as const,
              },
            ],
          },
        },
      ],
      [
        "a start date that is not on the calendar",
        { google: { ...google, startDate: "2026-02-31" } },
      ],
      [
        "an end date that is not on the calendar",
        { google: { ...google, endDate: "2026-13-01" } },
      ],
    ])("rejects %s, calling nothing", async (_name, changes) => {
      const { createAdCampaign } = await import("./action");
      const { revalidatePath } = await import("next/cache");
      const result = await createAdCampaign({ ...base, ...changes });

      expect(result).toMatchObject({ ok: false, error: { code: "BAD_INPUT" } });
      expect(adsServiceMock.createCampaign).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    });

    describe("Display", () => {
      const image = (role: "LANDSCAPE" | "SQUARE" | "LOGO", name: string) => ({
        pathname: `drive/users/user_1/${name}`,
        fileUrl: `https://store.public.blob.vercel-storage.com/drive/users/user_1/${name}`,
        name,
        size: 240000,
        mimeType: "image/png" as const,
        role,
      });
      const display = {
        type: "DISPLAY" as const,
        locationIds: ["2276"],
        languageIds: [],
        finalUrl: "https://example.com",
        businessName: "Acme",
        headlines: ["One"],
        longHeadline: "A longer headline",
        descriptions: ["First description"],
        images: [
          image("LANDSCAPE", "wide.png"),
          image("SQUARE", "square.png"),
          image("LOGO", "logo.png"),
        ],
      };

      it("passes the Display spec to Core as it is", async () => {
        adsServiceMock.createCampaign.mockResolvedValue({ id: "42" });

        const { createAdCampaign } = await import("./action");
        const result = await createAdCampaign({ ...base, google: display });

        expect(adsServiceMock.createCampaign).toHaveBeenCalledWith(
          "project-1",
          "account-1",
          { name: "Spring sale", dailyBudget: 25.5, google: display },
        );
        expect(result).toEqual({ ok: true, value: { id: "42" } });
      });

      it.each([
        ["no landscape image", { images: display.images.slice(1) }],
        ["no square image", { images: [display.images[0]] }],
        [
          "seven marketing images",
          {
            images: [
              ...Array.from({ length: 6 }, (_, i) =>
                image("LANDSCAPE", `wide-${i}.png`),
              ),
              image("SQUARE", "square.png"),
            ],
          },
        ],
        [
          "three logos",
          {
            images: [
              ...display.images,
              image("LOGO", "logo-2.png"),
              image("LOGO", "logo-3.png"),
            ],
          },
        ],
        [
          "one file twice",
          { images: [...display.images, image("LOGO", "wide.png")] },
        ],
        [
          "an image over 5120 KB",
          {
            images: [
              { ...display.images[0], size: 5 * 1024 * 1024 + 1 },
              display.images[1],
            ],
          },
        ],
        ["a 26-character business name", { businessName: "a".repeat(26) }],
        ["a 91-character long headline", { longHeadline: "a".repeat(91) }],
        ["six headlines", { headlines: ["a", "b", "c", "d", "e", "f"] }],
        ["repeated headlines", { headlines: ["Same", "same"] }],
        ["no descriptions", { descriptions: [] }],
        [
          "an end before the start",
          { startDate: "2026-11-02", endDate: "2026-11-01" },
        ],
      ])("rejects %s, calling nothing", async (_name, changes) => {
        const { createAdCampaign } = await import("./action");
        const result = await createAdCampaign({
          ...base,
          google: { ...display, ...changes },
        });

        expect(result).toMatchObject({
          ok: false,
          error: { code: "BAD_INPUT" },
        });
        expect(adsServiceMock.createCampaign).not.toHaveBeenCalled();
      });
    });

    it("keeps kept images out of a create", async () => {
      const { createAdCampaign } = await import("./action");
      const result = await createAdCampaign({
        ...base,
        google: {
          type: "DISPLAY",
          locationIds: [],
          languageIds: [],
          finalUrl: "https://example.com",
          businessName: "Acme",
          headlines: ["One"],
          longHeadline: "A longer headline",
          descriptions: ["First description"],
          images: [{ assetId: "a1", role: "LANDSCAPE" }],
        } as never,
      });

      expect(result).toMatchObject({ ok: false, error: { code: "BAD_INPUT" } });
      expect(adsServiceMock.createCampaign).not.toHaveBeenCalled();
    });

    it("passes Google's 422 message through", async () => {
      adsServiceMock.createCampaign.mockRejectedValue(
        await coreError("Destination not working.", 422),
      );

      const { createAdCampaign } = await import("./action");
      const result = await createAdCampaign({ ...base, google });

      expect(result).toMatchObject({
        ok: false,
        error: { status: 422, message: "Destination not working." },
      });
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

  describe("listAdMarketKeywords", () => {
    it("returns the names of the trending keywords", async () => {
      adsServiceMock.listMarketKeywords.mockResolvedValue({
        keywords: [{ keyword: "running shoes" }, { keyword: "trail shoes" }],
      });

      const { listAdMarketKeywords } = await import("./action");
      const result = await listAdMarketKeywords({ projectId: " project-1 " });

      expect(adsServiceMock.listMarketKeywords).toHaveBeenCalledWith(
        "project-1",
      );
      expect(result).toEqual({
        ok: true,
        value: ["running shoes", "trail shoes"],
      });
    });

    it("reports a Core failure", async () => {
      adsServiceMock.listMarketKeywords.mockRejectedValue(
        await coreError("down", 502),
      );

      const { listAdMarketKeywords } = await import("./action");
      const result = await listAdMarketKeywords({ projectId: "project-1" });

      expect(result).toMatchObject({ ok: false, error: { status: 502 } });
    });

    it("rejects a blank project, calling nothing", async () => {
      const { listAdMarketKeywords } = await import("./action");
      const result = await listAdMarketKeywords({ projectId: " " });

      expect(result).toMatchObject({ ok: false, error: { code: "BAD_INPUT" } });
      expect(adsServiceMock.listMarketKeywords).not.toHaveBeenCalled();
    });
  });

  describe("searchAdLocations", () => {
    const munich = {
      id: "1003854",
      name: "Munich",
      canonicalName: "Munich,Bavaria,Germany",
      targetType: "City",
      countryCode: "DE",
    };

    it("returns the matching locations for the trimmed text", async () => {
      adsServiceMock.searchLocations.mockResolvedValue({ locations: [munich] });

      const { searchAdLocations } = await import("./action");
      const result = await searchAdLocations({
        projectId: "project-1",
        accountId: "account-1",
        q: " Mun ",
      });

      expect(adsServiceMock.searchLocations).toHaveBeenCalledWith(
        "project-1",
        "account-1",
        "Mun",
      );
      expect(result).toEqual({ ok: true, value: [munich] });
    });

    it("reports a Core failure with its status", async () => {
      adsServiceMock.searchLocations.mockRejectedValue(
        await coreError("down", 502),
      );

      const { searchAdLocations } = await import("./action");
      const result = await searchAdLocations({
        projectId: "project-1",
        accountId: "account-1",
        q: "Mun",
      });

      expect(result).toMatchObject({ ok: false, error: { status: 502 } });
    });

    it.each([
      ["blank text", " "],
      ["text over 80 characters", "x".repeat(81)],
    ])("rejects %s, calling nothing", async (_name, q) => {
      const { searchAdLocations } = await import("./action");
      const result = await searchAdLocations({
        projectId: "project-1",
        accountId: "account-1",
        q,
      });

      expect(result).toMatchObject({ ok: false, error: { code: "BAD_INPUT" } });
      expect(adsServiceMock.searchLocations).not.toHaveBeenCalled();
    });
  });

  describe("saveAdsMarketProfile", () => {
    const input = {
      projectId: "project-1",
      keywords: [" running shoes ", "trail shoes"],
      countryCode: "DE" as const,
      languageCode: "de" as const,
    };

    it("saves the trimmed profile and revalidates Ads", async () => {
      const saved = { profile: null };
      adsServiceMock.saveMarketProfile.mockResolvedValue(saved);

      const { saveAdsMarketProfile } = await import("./action");
      const { revalidatePath } = await import("next/cache");
      const result = await saveAdsMarketProfile({ ...input });

      expect(adsServiceMock.saveMarketProfile).toHaveBeenCalledWith(
        "project-1",
        {
          keywords: ["running shoes", "trail shoes"],
          countryCode: "DE",
          languageCode: "de",
        },
      );
      expect(result).toEqual({ ok: true, value: saved });
      expect(revalidatePath).toHaveBeenCalledWith("/ads");
    });

    it.each([
      ["no keywords", { keywords: [] }],
      [
        "more than ten keywords",
        { keywords: Array.from({ length: 11 }, (_, i) => `k${i}`) },
      ],
      ["a keyword over 80 characters", { keywords: ["x".repeat(81)] }],
      ["an unsupported country", { countryCode: "ZZ" }],
      ["an unsupported language", { languageCode: "xx" }],
    ])("rejects %s, calling nothing", async (_name, override) => {
      const { saveAdsMarketProfile } = await import("./action");
      const result = await saveAdsMarketProfile({
        ...input,
        ...override,
      } as never);

      expect(result).toMatchObject({ ok: false, error: { code: "BAD_INPUT" } });
      expect(adsServiceMock.saveMarketProfile).not.toHaveBeenCalled();
    });

    it("keeps Core's status and does not revalidate when it refuses", async () => {
      adsServiceMock.saveMarketProfile.mockRejectedValue(
        await coreError("Project is closed", 409),
      );

      const { saveAdsMarketProfile } = await import("./action");
      const { revalidatePath } = await import("next/cache");
      const result = await saveAdsMarketProfile({ ...input });

      expect(result).toMatchObject({ ok: false, error: { status: 409 } });
      expect(revalidatePath).not.toHaveBeenCalled();
    });
  });

  describe("editAdCampaign", () => {
    const base = {
      projectId: "project-1",
      accountId: "account-1",
      campaignId: "42",
      name: "  Spring sale ",
      dailyBudget: 25.5,
    };
    const search = {
      type: "SEARCH" as const,
      locationIds: [],
      languageIds: [],
      finalUrl: "https://example.com",
      keywords: [{ text: "running shoes", matchType: "BROAD" as const }],
      headlines: ["One", "Two", "Three"],
      descriptions: ["First description", "Second description"],
    };

    it("edits the campaign, trims the name and revalidates the list and the details", async () => {
      adsServiceMock.editCampaign.mockResolvedValue(undefined);

      const { editAdCampaign } = await import("./action");
      const { revalidatePath } = await import("next/cache");
      const result = await editAdCampaign({ ...base, google: search });

      expect(adsServiceMock.editCampaign).toHaveBeenCalledWith(
        "project-1",
        "account-1",
        "42",
        { name: "Spring sale", dailyBudget: 25.5, google: search },
      );
      expect(result).toEqual({ ok: true, value: undefined });
      expect(revalidatePath).toHaveBeenCalledWith("/ads");
      expect(revalidatePath).toHaveBeenCalledWith("/ads/campaigns/42");
    });

    it("sends kept Display images as asset and role beside new Drive files", async () => {
      adsServiceMock.editCampaign.mockResolvedValue(undefined);
      const square = {
        pathname: "drive/users/user_1/square.png",
        fileUrl:
          "https://store.public.blob.vercel-storage.com/drive/users/user_1/square.png",
        name: "square.png",
        size: 240000,
        mimeType: "image/png" as const,
        role: "SQUARE" as const,
      };
      const google = {
        type: "DISPLAY" as const,
        locationIds: [],
        languageIds: [],
        finalUrl: "https://example.com",
        businessName: "Acme",
        headlines: ["One"],
        longHeadline: "A longer headline",
        descriptions: ["First description"],
        images: [{ assetId: "a1", role: "LANDSCAPE" as const }, square],
      };

      const { editAdCampaign } = await import("./action");
      const result = await editAdCampaign({ ...base, google });

      expect(result).toMatchObject({ ok: true });
      expect(adsServiceMock.editCampaign).toHaveBeenCalledWith(
        "project-1",
        "account-1",
        "42",
        { name: "Spring sale", dailyBudget: 25.5, google },
      );
    });

    it.each([
      ["a blank name", { name: "  " }],
      ["a zero budget", { dailyBudget: 0 }],
      ["no Google spec", { google: undefined }],
      ["a spec without keywords", { google: { ...search, keywords: [] } }],
    ])("rejects %s, calling nothing", async (_name, changes) => {
      const { editAdCampaign } = await import("./action");
      const result = await editAdCampaign({
        ...base,
        google: search,
        ...changes,
      } as never);

      expect(result).toMatchObject({ ok: false, error: { code: "BAD_INPUT" } });
      expect(adsServiceMock.editCampaign).not.toHaveBeenCalled();
    });

    it("reports Core's refusal with its status and message", async () => {
      adsServiceMock.editCampaign.mockRejectedValue(
        await coreError("Destination not working.", 422),
      );

      const { editAdCampaign } = await import("./action");
      const { revalidatePath } = await import("next/cache");
      const result = await editAdCampaign({ ...base, google: search });

      expect(result).toMatchObject({
        ok: false,
        error: { status: 422, message: "Destination not working." },
      });
      expect(revalidatePath).not.toHaveBeenCalled();
    });
  });
});
