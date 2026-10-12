import { OpenAPIHono } from "@hono/zod-openapi";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ComposioApiError,
  ComposioConfigError,
} from "@/clients/composio.client";
import { ComposioToolError } from "@/clients/social-post-providers/tools";
import {
  conflict,
  forbidden,
  notFound,
  unprocessableEntity,
} from "@/helpers/error";
import { errorHandler } from "@/helpers/error-handler";
import { defaultValidationHook, type EnvVariables } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import type { WorkspaceContext } from "@/middleware/workspace";
import mountUpdateCampaign from "./accounts/[accountId]/campaigns/[campaignId]/patch.js";
import mountListCampaigns from "./accounts/[accountId]/campaigns/get.js";
import mountCreateCampaign from "./accounts/[accountId]/campaigns/post.js";
import mountDeleteAccount from "./accounts/[accountId]/delete.js";
import mountListLanguages from "./accounts/[accountId]/targeting/languages/get.js";
import mountSearchLocations from "./accounts/[accountId]/targeting/locations/get.js";
import mountListAccounts from "./accounts/get.js";
import mountAttachAccounts from "./accounts/post.js";
import mountDiscardConnection from "./connections/[adConnectionId]/delete.js";
import mountFinalize from "./connections/finalize/post.js";
import mountInitiate from "./connections/initiate/post.js";

const m = vi.hoisted(() => ({
  requireSocialBetaAccess: vi.fn(),
  initiate: vi.fn(),
  finalize: vi.fn(),
  attach: vi.fn(),
  list: vi.fn(),
  detach: vi.fn(),
  discard: vi.fn(),
  campaigns: vi.fn(),
  updateCampaign: vi.fn(),
  createCampaign: vi.fn(),
  locations: vi.fn(),
  languages: vi.fn(),
}));

vi.mock("@/helpers/social-beta-access", () => ({
  requireSocialBetaAccess: m.requireSocialBetaAccess,
}));
vi.mock("@/services/project-ad-accounts.service", () => ({
  initiateProjectAdConnection: m.initiate,
  finalizeProjectAdConnection: m.finalize,
  attachProjectAdAccounts: m.attach,
  listProjectAdAccounts: m.list,
  detachProjectAdAccount: m.detach,
  discardProjectAdConnection: m.discard,
  listProjectAdCampaigns: m.campaigns,
  updateProjectAdCampaign: m.updateCampaign,
  createProjectAdCampaign: m.createCampaign,
  searchProjectAdLocations: m.locations,
  listProjectAdLanguages: m.languages,
}));
vi.mock("@/lib/db/prisma", () => ({ default: {} }));

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const CONNECTION_UUID = "33333333-3333-4333-8333-333333333333";
const ACCOUNT_UUID = "44444444-4444-4444-8444-444444444444";
const USER_ID = "user_123";

const SESSION_AUTH: AuthenticationContext = {
  actor: "user",
  userId: USER_ID,
  organizationId: null,
  role: "user",
  authenticationMethod: "session",
};
const WORKSPACE_CONTEXT: WorkspaceContext = {
  workspaceId: WORKSPACE_ID,
  userId: USER_ID,
  organizationId: null,
};

const account = {
  id: ACCOUNT_UUID,
  connectionId: CONNECTION_UUID,
  provider: "google_ads",
  externalAccountId: "111",
  loginCustomerId: null,
  name: "Shop",
  currency: "EUR",
  timeZone: "Europe/Berlin",
  createdAt: new Date("2026-09-30T10:00:00.000Z"),
  // Internal columns must never leave Core.
  projectId: PROJECT_ID,
};

const campaignsResult = {
  campaigns: [
    {
      id: "1",
      name: "Brand",
      status: "ACTIVE",
      objective: "SEARCH",
      dailyBudget: 12.5,
      spend: 20,
      impressions: 1000,
      clicks: 40,
      ctr: 0.04,
      cpc: 0.5,
      conversions: null,
    },
  ],
  range: "LAST_30_DAYS",
  currency: "EUR",
};

function createApp(
  authContext: AuthenticationContext = SESSION_AUTH,
  workspaceContext: WorkspaceContext | null = WORKSPACE_CONTEXT,
) {
  const app = new OpenAPIHono<EnvVariables>({
    defaultHook: defaultValidationHook,
  });
  app.onError(errorHandler);
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    c.set("workspaceContext", workspaceContext);
    await next();
  });
  mountListAccounts(app);
  mountInitiate(app);
  mountFinalize(app);
  mountAttachAccounts(app);
  mountDeleteAccount(app);
  mountDiscardConnection(app);
  mountListCampaigns(app);
  mountUpdateCampaign(app);
  mountCreateCampaign(app);
  mountSearchLocations(app);
  mountListLanguages(app);
  return app;
}

function post(app: ReturnType<typeof createApp>, path: string, body: unknown) {
  return app.request(`http://localhost/${PROJECT_ID}/ads/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Project ads routes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    m.requireSocialBetaAccess.mockResolvedValue(undefined);
    m.initiate.mockResolvedValue({
      connectionId: "ca_123",
      redirectUrl: "https://connect.composio.dev/link-token",
    });
    m.finalize.mockResolvedValue({
      connection: {
        id: CONNECTION_UUID,
        provider: "google_ads",
        status: "active",
        createdAt: new Date("2026-09-30T10:00:00.000Z"),
      },
      availableAccounts: [
        {
          externalAccountId: "111",
          name: "Shop",
          currency: "EUR",
          timeZone: null,
          loginCustomerId: null,
        },
      ],
    });
    m.attach.mockResolvedValue([account]);
    m.list.mockResolvedValue([account]);
    m.detach.mockResolvedValue(undefined);
    m.campaigns.mockResolvedValue(campaignsResult);
  });

  it.each(["google_ads", "meta_ads"] as const)(
    "initiates and finalizes a %s connection for the session user",
    async (provider) => {
      const app = createApp();
      const initiated = await post(app, "connections/initiate", { provider });
      expect(initiated.status).toBe(201);
      expect(await initiated.json()).toMatchObject({
        data: {
          connectionId: "ca_123",
          redirectUrl: "https://connect.composio.dev/link-token",
        },
      });
      expect(m.initiate).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        userId: USER_ID,
        provider,
      });

      m.finalize.mockResolvedValueOnce({
        connection: {
          id: CONNECTION_UUID,
          provider,
          status: "active",
          createdAt: new Date("2026-09-30T10:00:00.000Z"),
        },
        availableAccounts: [],
      });
      const finalized = await post(app, "connections/finalize", {
        connectionId: "ca_123",
      });
      expect(finalized.status).toBe(200);
      expect(await finalized.json()).toMatchObject({
        data: { connection: { provider }, availableAccounts: [] },
      });
      expect(m.finalize).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        userId: USER_ID,
        connectionId: "ca_123",
      });
    },
  );

  it("rejects an unknown provider", async () => {
    const response = await post(createApp(), "connections/initiate", {
      provider: "tiktok_ads",
    });
    expect(response.status).toBe(422);
    expect(m.initiate).not.toHaveBeenCalled();
  });

  it("attaches accounts and lists them without internal columns", async () => {
    const app = createApp();
    const attached = await post(app, "accounts", {
      adConnectionId: CONNECTION_UUID,
      externalAccountIds: ["111"],
    });
    expect(attached.status).toBe(200);
    expect(m.attach).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      adConnectionId: CONNECTION_UUID,
      externalAccountIds: ["111"],
    });

    const listed = await app.request(
      `http://localhost/${PROJECT_ID}/ads/accounts`,
    );
    expect(listed.status).toBe(200);
    const body = await listed.json();
    expect(body).toMatchObject({
      data: [{ id: ACCOUNT_UUID, externalAccountId: "111", currency: "EUR" }],
    });
    expect(JSON.stringify(body)).not.toContain("projectId");
  });

  it("rejects an attach without any account id", async () => {
    const response = await post(createApp(), "accounts", {
      adConnectionId: CONNECTION_UUID,
      externalAccountIds: [],
    });
    expect(response.status).toBe(422);
    expect(m.attach).not.toHaveBeenCalled();
  });

  it("lets a finalize of an empty grant return a null connection", async () => {
    m.finalize.mockResolvedValueOnce({
      connection: null,
      availableAccounts: [],
    });
    const response = await post(createApp(), "connections/finalize", {
      connectionId: "ca_123",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { connection: null, availableAccounts: [] },
    });
  });

  it("passes a detach conflict through as 409", async () => {
    m.detach.mockRejectedValue(conflict("Ad account changed. Please retry."));
    const response = await createApp().request(
      `http://localhost/${PROJECT_ID}/ads/accounts/${ACCOUNT_UUID}`,
      { method: "DELETE" },
    );
    expect(response.status).toBe(409);
  });

  it("detaches an account with 204", async () => {
    const response = await createApp().request(
      `http://localhost/${PROJECT_ID}/ads/accounts/${ACCOUNT_UUID}`,
      { method: "DELETE" },
    );
    expect(response.status).toBe(204);
    expect(m.detach).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      accountId: ACCOUNT_UUID,
    });
  });

  describe("discard connection", () => {
    const discard = (app = createApp(), id = CONNECTION_UUID) =>
      app.request(`http://localhost/${PROJECT_ID}/ads/connections/${id}`, {
        method: "DELETE",
      });

    it("discards a connection with 204", async () => {
      const response = await discard();
      expect(response.status).toBe(204);
      expect(m.discard).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        adConnectionId: CONNECTION_UUID,
      });
    });

    it("passes a connection with ad accounts through as 409", async () => {
      m.discard.mockRejectedValue(conflict("Disconnect its ad accounts"));
      expect((await discard()).status).toBe(409);
    });

    it("passes a connection of another Project through as 404", async () => {
      m.discard.mockRejectedValue(notFound("Ad connection not found"));
      expect((await discard()).status).toBe(404);
    });

    it("maps a failed revoke to 502", async () => {
      m.discard.mockRejectedValue(new ComposioApiError(500, undefined, "boom"));
      expect((await discard()).status).toBe(502);
    });

    it("rejects a malformed connection id", async () => {
      const response = await discard(createApp(), "not-a-uuid");
      expect(response.status).toBe(422);
      expect(m.discard).not.toHaveBeenCalled();
    });

    it("denies users outside the beta before any work", async () => {
      m.requireSocialBetaAccess.mockRejectedValue(forbidden("beta only"));
      expect((await discard()).status).toBe(403);
      expect(m.discard).not.toHaveBeenCalled();
    });
  });

  describe("list campaigns", () => {
    const campaignsUrl = (query = "") =>
      `http://localhost/${PROJECT_ID}/ads/accounts/${ACCOUNT_UUID}/campaigns${query}`;

    it("returns campaigns, defaulting the range to the last 30 days", async () => {
      const response = await createApp().request(campaignsUrl());
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ data: campaignsResult });
      expect(m.campaigns).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        accountId: ACCOUNT_UUID,
        range: "LAST_30_DAYS",
      });
    });

    it("passes the requested range", async () => {
      const response = await createApp().request(
        campaignsUrl("?range=LAST_7_DAYS"),
      );
      expect(response.status).toBe(200);
      expect(m.campaigns).toHaveBeenCalledWith(
        expect.objectContaining({ range: "LAST_7_DAYS" }),
      );
    });

    it("rejects an unknown range", async () => {
      const response = await createApp().request(
        campaignsUrl("?range=LAST_YEAR"),
      );
      expect(response.status).toBe(422);
      expect(m.campaigns).not.toHaveBeenCalled();
    });

    it.each([
      ["foreign account", notFound("Ad account not found"), 404],
      ["disconnected connection", conflict("Ad connection is not active"), 409],
      [
        "Composio tool error",
        new ComposioToolError({ message: "secret detail" }),
        502,
      ],
      ["missing Composio configuration", new ComposioConfigError("nope"), 503],
    ])("maps %s to %i", async (_name, error, status) => {
      m.campaigns.mockRejectedValue(error);
      const response = await createApp().request(campaignsUrl());
      expect(response.status).toBe(status);
      expect(await response.text()).not.toContain("secret detail");
    });

    it("denies users outside the beta before any work", async () => {
      m.requireSocialBetaAccess.mockRejectedValue(forbidden("beta only"));
      const response = await createApp().request(campaignsUrl());
      expect(response.status).toBe(403);
      expect(m.campaigns).not.toHaveBeenCalled();
    });
  });

  describe("update campaign", () => {
    const campaignUrl = (campaignId = "42") =>
      `http://localhost/${PROJECT_ID}/ads/accounts/${ACCOUNT_UUID}/campaigns/${campaignId}`;
    const patch = (body: unknown, campaignId?: string) =>
      createApp().request(campaignUrl(campaignId), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

    it.each([
      ["status only", { status: "PAUSED" }],
      ["budget only", { dailyBudget: 12.5 }],
      ["both", { status: "ACTIVE", dailyBudget: 20 }],
    ])("accepts %s and returns 204", async (_name, body) => {
      const response = await patch(body);
      expect(response.status).toBe(204);
      expect(m.updateCampaign).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        accountId: ACCOUNT_UUID,
        campaignId: "42",
        ...body,
      });
    });

    it.each([
      ["no fields", {}],
      ["unknown status", { status: "DELETED" }],
      ["zero budget", { dailyBudget: 0 }],
      ["negative budget", { dailyBudget: -5 }],
      ["string budget", { dailyBudget: "10" }],
    ])("rejects %s", async (_name, body) => {
      const response = await patch(body);
      expect(response.status).toBe(422);
      expect(m.updateCampaign).not.toHaveBeenCalled();
    });

    it.each(["abc", "1; DROP", "-1", "1.5"])(
      "rejects campaign id %s",
      async (campaignId) => {
        const response = await patch({ status: "PAUSED" }, campaignId);
        expect(response.status).toBe(422);
        expect(m.updateCampaign).not.toHaveBeenCalled();
      },
    );

    it.each([
      ["foreign account or campaign", notFound("Campaign not found"), 404],
      ["disconnected connection", conflict("Ad connection is not active"), 409],
      ["shared budget", conflict("This campaign uses a shared budget"), 409],
      ["too many decimals", unprocessableEntity("Too many decimals"), 422],
      [
        "Composio tool error",
        new ComposioToolError({ message: "secret detail" }),
        502,
      ],
      ["missing Composio configuration", new ComposioConfigError("nope"), 503],
    ])("maps %s to %i", async (_name, error, status) => {
      m.updateCampaign.mockRejectedValue(error);
      const response = await patch({ status: "PAUSED" });
      expect(response.status).toBe(status);
      expect(await response.text()).not.toContain("secret detail");
    });

    it("denies users outside the beta before any work", async () => {
      m.requireSocialBetaAccess.mockRejectedValue(forbidden("beta only"));
      const response = await patch({ status: "PAUSED" });
      expect(response.status).toBe(403);
      expect(m.updateCampaign).not.toHaveBeenCalled();
    });
  });

  describe("create campaign", () => {
    const campaignsUrl = `http://localhost/${PROJECT_ID}/ads/accounts/${ACCOUNT_UUID}/campaigns`;
    const createPost = (body: unknown) =>
      createApp().request(campaignsUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

    const googleSpec = {
      type: "SEARCH",
      locationIds: ["2276"],
      languageIds: ["1001"],
      finalUrl: "https://example.com/spring",
      keywords: [{ text: "running shoes", matchType: "BROAD" }],
      headlines: ["One", "Two", "Three"],
      descriptions: ["First description", "Second description"],
    };
    const sitelink = (text: string) => ({
      text,
      finalUrl: "https://example.com/page",
    });
    const withGoogle = (changes: Record<string, unknown>) => ({
      name: "Spring",
      dailyBudget: 5,
      google: { ...googleSpec, ...changes },
    });

    beforeEach(() => {
      m.createCampaign.mockResolvedValue({ id: "42" });
    });

    it.each([
      [
        "a Meta objective",
        { name: "Spring", dailyBudget: 12.5, objective: "OUTCOME_TRAFFIC" },
      ],
      [
        "a Google spec",
        { name: "Spring", dailyBudget: 12.5, google: googleSpec },
      ],
      [
        "neither (the service refuses it)",
        { name: "Spring", dailyBudget: 12.5 },
      ],
    ])(
      "creates a campaign with %s and returns 201 with its id",
      async (_name, body) => {
        const response = await createPost(body);
        expect(response.status).toBe(201);
        expect((await response.json()).data).toEqual({ id: "42" });
        expect(m.createCampaign).toHaveBeenCalledWith({
          projectId: PROJECT_ID,
          workspaceId: WORKSPACE_ID,
          accountId: ACCOUNT_UUID,
          userId: USER_ID,
          organizationId: null,
          ...body,
        });
      },
    );

    it("trims the name, keywords, headlines and descriptions", async () => {
      await createPost(
        withGoogle({
          keywords: [{ text: "  shoes ", matchType: "EXACT" }],
          headlines: [" One ", "Two", "Three"],
          descriptions: [" First ", "Second"],
        }),
      );
      expect(m.createCampaign.mock.calls[0]?.[0].google).toMatchObject({
        keywords: [{ text: "shoes", matchType: "EXACT" }],
        headlines: ["One", "Two", "Three"],
        descriptions: ["First", "Second"],
      });
      m.createCampaign.mockClear();
      await createPost({ name: "  Spring  ", dailyBudget: 5 });
      expect(m.createCampaign).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Spring" }),
      );
    });

    it("trims sitelinks and callouts", async () => {
      await createPost(
        withGoogle({
          sitelinks: [
            {
              text: " Shoes ",
              finalUrl: "https://example.com/shoes",
              description1: " One ",
              description2: " Two ",
            },
          ],
          callouts: [" Free shipping "],
        }),
      );
      expect(m.createCampaign.mock.calls[0]?.[0].google).toMatchObject({
        sitelinks: [
          {
            text: "Shoes",
            finalUrl: "https://example.com/shoes",
            description1: "One",
            description2: "Two",
          },
        ],
        callouts: ["Free shipping"],
      });
    });

    it("has no status input: a requested status never reaches the service", async () => {
      const response = await createPost({
        name: "Spring",
        dailyBudget: 5,
        status: "ACTIVE",
      });
      expect(response.status).toBe(201);
      expect(m.createCampaign.mock.calls[0]?.[0]).not.toHaveProperty("status");
    });

    it.each([
      ["missing name", { dailyBudget: 5 }],
      ["empty name", { name: "", dailyBudget: 5 }],
      ["whitespace name", { name: "   ", dailyBudget: 5 }],
      ["too long name", { name: "x".repeat(256), dailyBudget: 5 }],
      ["missing budget", { name: "Spring" }],
      ["zero budget", { name: "Spring", dailyBudget: 0 }],
      ["negative budget", { name: "Spring", dailyBudget: -1 }],
      ["string budget", { name: "Spring", dailyBudget: "5" }],
      [
        "unknown objective",
        { name: "Spring", dailyBudget: 5, objective: "OUTCOME_APP_PROMOTION" },
      ],
    ])("rejects %s", async (_name, body) => {
      const response = await createPost(body);
      expect(response.status).toBe(422);
      expect(m.createCampaign).not.toHaveBeenCalled();
    });

    it.each([
      [
        "a duplicate keyword",
        {
          keywords: [
            { text: "Shoes", matchType: "BROAD" },
            { text: "shoes", matchType: "BROAD" },
          ],
        },
      ],
      [
        "the same keyword with another match type",
        {
          keywords: [
            { text: "Shoes", matchType: "BROAD" },
            { text: "shoes", matchType: "EXACT" },
          ],
        },
      ],
    ])("accepts %s (the provider drops repeats)", async (_name, changes) => {
      expect((await createPost(withGoogle(changes))).status).toBe(201);
    });

    it.each([
      ["an unknown type", { type: "VIDEO" }],
      ["no type", { type: undefined }],
      ["a missing final URL", { finalUrl: undefined }],
      ["a non-http final URL", { finalUrl: "javascript:alert(1)" }],
      [
        "a too long final URL",
        { finalUrl: `https://example.com/${"a".repeat(2048)}` },
      ],
      ["no keywords", { keywords: [] }],
      [
        "51 keywords",
        {
          keywords: Array.from({ length: 51 }, (_, i) => ({
            text: `kw ${i}`,
            matchType: "BROAD",
          })),
        },
      ],
      ["an empty keyword", { keywords: [{ text: "  ", matchType: "BROAD" }] }],
      [
        "a keyword over 80 characters",
        { keywords: [{ text: "a".repeat(81), matchType: "BROAD" }] },
      ],
      [
        "a keyword of 11 words",
        { keywords: [{ text: "a b c d e f g h i j k", matchType: "BROAD" }] },
      ],
      [
        "an unknown match type",
        { keywords: [{ text: "shoes", matchType: "NEGATIVE" }] },
      ],
      ["2 headlines", { headlines: ["One", "Two"] }],
      [
        "16 headlines",
        { headlines: Array.from({ length: 16 }, (_, i) => `H${i}`) },
      ],
      [
        "a headline over 30 characters",
        { headlines: ["a".repeat(31), "Two", "Three"] },
      ],
      [
        "a duplicate headline ignoring case",
        { headlines: ["One", "one", "Three"] },
      ],
      ["1 description", { descriptions: ["Only one"] }],
      ["5 descriptions", { descriptions: ["1", "2", "3", "4", "5"] }],
      [
        "a description over 90 characters",
        { descriptions: ["a".repeat(91), "Two"] },
      ],
      ["a path over 15 characters", { path1: "a".repeat(16) }],
      ["path2 without path1", { path2: "spring" }],
      [
        "9 sitelinks",
        { sitelinks: Array.from({ length: 9 }, (_, i) => sitelink(`S${i}`)) },
      ],
      [
        "a sitelink text over 25 characters",
        { sitelinks: [sitelink("a".repeat(26))] },
      ],
      ["an empty sitelink text", { sitelinks: [sitelink("  ")] }],
      [
        "a sitelink without http(s) url",
        {
          sitelinks: [{ ...sitelink("Shoes"), finalUrl: "ftp://example.com" }],
        },
      ],
      [
        "a sitelink description over 35 characters",
        {
          sitelinks: [
            {
              ...sitelink("Shoes"),
              description1: "a".repeat(36),
              description2: "ok",
            },
          ],
        },
      ],
      [
        "only one sitelink description",
        { sitelinks: [{ ...sitelink("Shoes"), description1: "Light" }] },
      ],
      [
        "duplicate sitelink texts ignoring case",
        { sitelinks: [sitelink("Shoes"), sitelink("shoes")] },
      ],
      [
        "11 callouts",
        { callouts: Array.from({ length: 11 }, (_, i) => `C${i}`) },
      ],
      ["a callout over 25 characters", { callouts: ["a".repeat(26)] }],
      ["an empty callout", { callouts: [" "] }],
      ["duplicate callouts ignoring case", { callouts: ["Free", "free"] }],
      [
        "26 locations",
        { locationIds: Array.from({ length: 26 }, (_, i) => `${i}`) },
      ],
      ["a non-numeric location", { locationIds: ["Berlin"] }],
      ["a non-numeric language", { languageIds: ["en"] }],
      ["a malformed date", { startDate: "01.11.2026" }],
      ["an impossible date", { startDate: "2026-02-30" }],
      [
        "an end date before the start date",
        { startDate: "2026-11-02", endDate: "2026-11-01" },
      ],
    ])("rejects a Google spec with %s", async (_name, changes) => {
      const response = await createPost(withGoogle(changes));
      expect(response.status).toBe(422);
      expect(m.createCampaign).not.toHaveBeenCalled();
    });

    it.each([
      ["no locations or languages", { locationIds: [], languageIds: [] }],
      [
        "25 locations",
        { locationIds: Array.from({ length: 25 }, (_, i) => `${i}`) },
      ],
      ["both paths", { path1: "shoes", path2: "spring" }],
      [
        "8 sitelinks, with and without descriptions",
        {
          sitelinks: [
            {
              ...sitelink("S0"),
              description1: "a".repeat(35),
              description2: "b",
            },
            ...Array.from({ length: 7 }, (_, i) => sitelink(`S${i + 1}`)),
          ],
        },
      ],
      [
        "a 25-character sitelink text",
        { sitelinks: [sitelink("a".repeat(25))] },
      ],
      [
        "10 callouts of up to 25 characters",
        {
          callouts: [
            "a".repeat(25),
            ...Array.from({ length: 9 }, (_, i) => `C${i}`),
          ],
        },
      ],
      ["empty sitelinks and callouts", { sitelinks: [], callouts: [] }],
      [
        "an end date equal to the start date",
        { startDate: "2026-11-01", endDate: "2026-11-01" },
      ],
      ["only an end date", { endDate: "2026-11-01" }],
      [
        "15 headlines and 4 descriptions",
        {
          headlines: Array.from({ length: 15 }, (_, i) => `H${i}`),
          descriptions: ["1", "2", "3", "4"],
        },
      ],
    ])("accepts a Google spec with %s", async (_name, changes) => {
      const response = await createPost(withGoogle(changes));
      expect(response.status).toBe(201);
    });

    describe("Display spec", () => {
      const BLOB = "https://store.public.blob.vercel-storage.com";
      const image = (
        role: "LANDSCAPE" | "SQUARE" | "LOGO",
        n: number,
        changes: Record<string, unknown> = {},
      ) => ({
        pathname: `drive/users/${USER_ID}/${role.toLowerCase()}-${n}.png`,
        fileUrl: `${BLOB}/drive/users/${USER_ID}/${role.toLowerCase()}-${n}.png`,
        name: `${role.toLowerCase()}-${n}.png`,
        size: 240_000,
        mimeType: "image/png",
        role,
        ...changes,
      });
      const images = (landscape: number, square: number, logo = 0) => [
        ...Array.from({ length: landscape }, (_, i) => image("LANDSCAPE", i)),
        ...Array.from({ length: square }, (_, i) => image("SQUARE", i)),
        ...Array.from({ length: logo }, (_, i) => image("LOGO", i)),
      ];
      const displaySpec = {
        type: "DISPLAY",
        locationIds: ["2276"],
        languageIds: ["1001"],
        finalUrl: "https://example.com/spring",
        businessName: "Acme Shoes",
        headlines: ["Run faster"],
        longHeadline: "Run faster in the lightest shoes",
        descriptions: ["Shoes for every runner."],
        images: images(1, 1),
      };
      const withDisplay = (changes: Record<string, unknown>) => ({
        name: "Spring",
        dailyBudget: 5,
        google: { ...displaySpec, ...changes },
      });

      it("creates a Display campaign and hands the spec to the service with the Workspace", async () => {
        const response = await createPost(withDisplay({}));
        expect(response.status).toBe(201);
        expect(m.createCampaign).toHaveBeenCalledWith(
          expect.objectContaining({
            userId: USER_ID,
            organizationId: null,
            google: displaySpec,
          }),
        );
      });

      it("trims the business name, headlines, long headline and descriptions", async () => {
        await createPost(
          withDisplay({
            businessName: " Acme ",
            headlines: [" One "],
            longHeadline: " Long ",
            descriptions: [" First "],
          }),
        );
        expect(m.createCampaign.mock.calls[0]?.[0].google).toMatchObject({
          businessName: "Acme",
          headlines: ["One"],
          longHeadline: "Long",
          descriptions: ["First"],
        });
      });

      it.each([
        ["no images", { images: [] }],
        ["no LANDSCAPE image", { images: images(0, 1, 1) }],
        ["no SQUARE image", { images: images(1, 0, 1) }],
        ["only logos", { images: images(0, 0, 2) }],
        ["7 marketing images", { images: images(4, 3) }],
        ["3 logos", { images: images(1, 1, 3) }],
        ["more than 8 images", { images: images(3, 3, 3) }],
        [
          "the same file twice",
          { images: [...images(1, 1), image("LANDSCAPE", 0)] },
        ],
        [
          "a webp image",
          {
            images: [
              image("LANDSCAPE", 0, { mimeType: "image/webp" }),
              image("SQUARE", 0),
            ],
          },
        ],
        [
          "an image over 5120 KB",
          {
            images: [
              image("LANDSCAPE", 0, { size: 5_242_881 }),
              image("SQUARE", 0),
            ],
          },
        ],
        [
          "an empty image",
          { images: [image("LANDSCAPE", 0, { size: 0 }), image("SQUARE", 0)] },
        ],
        [
          "an unknown image role",
          {
            images: [
              image("LANDSCAPE", 0, { role: "BANNER" }),
              image("SQUARE", 0),
            ],
          },
        ],
        [
          "an image without a URL",
          {
            images: [
              image("LANDSCAPE", 0, { fileUrl: undefined }),
              image("SQUARE", 0),
            ],
          },
        ],
        ["no business name", { businessName: undefined }],
        [
          "a business name over 25 characters",
          { businessName: "a".repeat(26) },
        ],
        ["no headlines", { headlines: [] }],
        ["6 headlines", { headlines: ["1", "2", "3", "4", "5", "6"] }],
        ["a headline over 30 characters", { headlines: ["a".repeat(31)] }],
        [
          "duplicate headlines ignoring case",
          { headlines: ["Run faster", "run FASTER"] },
        ],
        ["no long headline", { longHeadline: undefined }],
        [
          "a long headline over 90 characters",
          { longHeadline: "a".repeat(91) },
        ],
        ["no descriptions", { descriptions: [] }],
        ["6 descriptions", { descriptions: ["1", "2", "3", "4", "5", "6"] }],
        [
          "a description over 90 characters",
          { descriptions: ["a".repeat(91)] },
        ],
        ["a missing final URL", { finalUrl: undefined }],
      ])("rejects a Display spec with %s", async (_name, changes) => {
        const response = await createPost(withDisplay(changes));
        expect(response.status).toBe(422);
        expect(m.createCampaign).not.toHaveBeenCalled();
      });

      it.each([
        ["6 marketing images and 2 logos", { images: images(3, 3, 2) }],
        ["5 landscape and 1 square image", { images: images(5, 1) }],
        [
          "JPEG and GIF images of exactly 5120 KB",
          {
            images: [
              image("LANDSCAPE", 0, {
                mimeType: "image/jpeg",
                size: 5_242_880,
              }),
              image("SQUARE", 0, { mimeType: "image/gif" }),
            ],
          },
        ],
        [
          "5 headlines, 5 descriptions and the longest texts",
          {
            businessName: "a".repeat(25),
            headlines: ["1", "2", "3", "4", "a".repeat(30)],
            longHeadline: "a".repeat(90),
            descriptions: ["1", "2", "3", "4", "a".repeat(90)],
          },
        ],
        ["no locations or languages", { locationIds: [], languageIds: [] }],
      ])("accepts a Display spec with %s", async (_name, changes) => {
        const response = await createPost(withDisplay(changes));
        expect(response.status).toBe(201);
      });
    });

    it.each([
      ["foreign account", notFound("Ad account not found"), 404],
      ["disconnected connection", conflict("Ad connection is not active"), 409],
      [
        "Meta without objective",
        unprocessableEntity("Objective required"),
        422,
      ],
      ["a Google validation failure", unprocessableEntity("Too long."), 422],
      [
        "Composio tool error",
        new ComposioToolError({ message: "secret detail" }),
        502,
      ],
      ["missing Composio configuration", new ComposioConfigError("nope"), 503],
    ])("maps %s to %i", async (_name, error, status) => {
      m.createCampaign.mockRejectedValue(error);
      const response = await createPost({ name: "Spring", dailyBudget: 5 });
      expect(response.status).toBe(status);
      expect(await response.text()).not.toContain("secret detail");
    });

    it("denies users outside the beta before any work", async () => {
      m.requireSocialBetaAccess.mockRejectedValue(forbidden("beta only"));
      const response = await createPost({ name: "Spring", dailyBudget: 5 });
      expect(response.status).toBe(403);
      expect(m.createCampaign).not.toHaveBeenCalled();
    });
  });

  describe("targeting lookups", () => {
    const targetingUrl = (what: "locations" | "languages", query = "") =>
      `http://localhost/${PROJECT_ID}/ads/accounts/${ACCOUNT_UUID}/targeting/${what}${query}`;
    const locationsResult = {
      locations: [
        {
          id: "2276",
          name: "Germany",
          canonicalName: "Germany",
          targetType: "Country",
          countryCode: "DE",
        },
        {
          id: "1003854",
          name: "Berlin",
          canonicalName: "Berlin,Berlin,Germany",
          targetType: null,
          countryCode: null,
        },
      ],
    };
    const scope = {
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      accountId: ACCOUNT_UUID,
    };

    beforeEach(() => {
      m.locations.mockResolvedValue(locationsResult);
      m.languages.mockResolvedValue({
        languages: [{ id: "1001", code: "de", name: "German" }],
      });
    });

    it("searches locations by text", async () => {
      const response = await createApp().request(
        targetingUrl("locations", "?q=%20Berlin%20(DE)%20"),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ data: locationsResult });
      expect(m.locations).toHaveBeenCalledWith({ ...scope, q: "Berlin (DE)" });
    });

    it("looks locations up by comma-separated ids", async () => {
      const response = await createApp().request(
        targetingUrl("locations", "?ids=2276,2840"),
      );
      expect(response.status).toBe(200);
      expect(m.locations).toHaveBeenCalledWith({
        ...scope,
        ids: ["2276", "2840"],
      });
    });

    it.each([
      "O'Brien",
      'a"b',
      "100%",
      "a\\b",
      "a_b",
      "a' OR 1=1",
      "Zürich, 東京-都 (St.)",
      "B",
      "a".repeat(80),
    ])("accepts the search text %j", async (q) => {
      const response = await createApp().request(
        targetingUrl("locations", `?q=${encodeURIComponent(q)}`),
      );
      expect(response.status).toBe(200);
      expect(m.locations).toHaveBeenCalledWith({ ...scope, q });
    });

    it.each([
      ["no input", ""],
      ["both q and ids", "?q=Berlin&ids=2276"],
      ["an empty q", "?q="],
      ["a blank q", "?q=%20%20"],
      ["an 81-character q", `?q=${"a".repeat(81)}`],
      ["an empty ids", "?ids="],
      ["a non-digit id", "?ids=2276,abc"],
      ["an empty id between commas", "?ids=2276,,2840"],
      ["a trailing comma", "?ids=2276,"],
      ["a leading comma", "?ids=,2276"],
      ["an injected id", `?ids=${encodeURIComponent("1) OR (1=1")}`],
      ["a 21-digit id", `?ids=${"1".repeat(21)}`],
      [
        "26 ids",
        `?ids=${Array.from({ length: 26 }, (_, i) => i + 1).join(",")}`,
      ],
    ])("rejects %s with 422", async (_name, query) => {
      const response = await createApp().request(
        targetingUrl("locations", query),
      );
      expect(response.status).toBe(422);
      expect(m.locations).not.toHaveBeenCalled();
    });

    it("accepts 25 ids", async () => {
      const ids = Array.from({ length: 25 }, (_, i) => i + 1);
      const response = await createApp().request(
        targetingUrl("locations", `?ids=${ids.join(",")}`),
      );
      expect(response.status).toBe(200);
      expect(m.locations).toHaveBeenCalledWith({
        ...scope,
        ids: ids.map(String),
      });
    });

    it("returns 25 locations for 25 ids", async () => {
      m.locations.mockResolvedValue({
        locations: Array.from({ length: 25 }, (_, i) => ({
          id: String(i + 1),
          name: `Place ${i + 1}`,
          canonicalName: `Place ${i + 1}`,
          targetType: null,
          countryCode: null,
        })),
      });
      const response = await createApp().request(
        targetingUrl("locations", "?ids=1"),
      );
      expect(response.status).toBe(200);
      expect((await response.json()).data.locations).toHaveLength(25);
    });

    it("lists languages", async () => {
      const response = await createApp().request(targetingUrl("languages"));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        data: { languages: [{ id: "1001", code: "de", name: "German" }] },
      });
      expect(m.languages).toHaveBeenCalledWith(scope);
    });

    it.each([
      ["locations", "?q=Berlin", () => m.locations],
      ["languages", "", () => m.languages],
    ] as const)("maps service errors for %s", async (what, query, service) => {
      for (const [error, status] of [
        [notFound("Targeting is only available for Google Ads accounts"), 404],
        [conflict("Ad connection is not active"), 409],
        [new ComposioToolError({ message: "secret detail" }), 502],
        [new ComposioConfigError("nope"), 503],
      ] as const) {
        service().mockRejectedValue(error);
        const response = await createApp().request(targetingUrl(what, query));
        expect(response.status).toBe(status);
        expect(await response.text()).not.toContain("secret detail");
      }
    });

    it("denies users outside the beta before any work", async () => {
      m.requireSocialBetaAccess.mockRejectedValue(forbidden("beta only"));
      const app = createApp();
      const responses = await Promise.all([
        app.request(targetingUrl("locations", "?q=Berlin")),
        app.request(targetingUrl("languages")),
      ]);
      expect(responses.map((r) => r.status)).toEqual([403, 403]);
      expect(m.locations).not.toHaveBeenCalled();
      expect(m.languages).not.toHaveBeenCalled();
    });

    it("rejects a user API key", async () => {
      const app = createApp({
        ...SESSION_AUTH,
        authenticationMethod: "api_key",
      });
      const response = await app.request(targetingUrl("languages"));
      expect(response.status).toBe(403);
      expect(m.languages).not.toHaveBeenCalled();
    });
  });

  describe("error mapping", () => {
    const initiate = () =>
      post(createApp(), "connections/initiate", { provider: "google_ads" });

    it("maps a missing Composio configuration to 503 with a machine-readable kind", async () => {
      m.initiate.mockRejectedValue(new ComposioConfigError("not configured"));
      const response = await initiate();
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        kind: CORE_API_ERROR_KINDS.INTEGRATION_NOT_CONFIGURED,
      });
    });

    it.each([
      [
        "Composio API error",
        new ComposioApiError(401, undefined, "secret detail"),
      ],
      ["tool error", new ComposioToolError({ message: "secret detail" })],
    ])("maps a %s to 502 with a safe message", async (_name, error) => {
      m.initiate.mockRejectedValue(error);
      const response = await initiate();
      expect(response.status).toBe(502);
      expect(await response.text()).not.toContain("secret detail");
    });

    it("keeps a wrong-Project 404", async () => {
      m.initiate.mockRejectedValue(notFound("Project not found"));
      expect((await initiate()).status).toBe(404);
    });

    it("maps an unexpected error to 500", async () => {
      m.initiate.mockRejectedValue(new Error("boom"));
      expect((await initiate()).status).toBe(500);
    });
  });

  describe("access", () => {
    it("denies users outside the beta before any work", async () => {
      m.requireSocialBetaAccess.mockRejectedValue(forbidden("beta only"));
      const app = createApp();
      const responses = await Promise.all([
        app.request(`http://localhost/${PROJECT_ID}/ads/accounts`),
        post(app, "connections/initiate", { provider: "google_ads" }),
        post(app, "connections/finalize", { connectionId: "ca_123" }),
        post(app, "accounts", {
          adConnectionId: CONNECTION_UUID,
          externalAccountIds: ["111"],
        }),
        app.request(
          `http://localhost/${PROJECT_ID}/ads/accounts/${ACCOUNT_UUID}`,
          { method: "DELETE" },
        ),
      ]);
      expect(responses.map((r) => r.status)).toEqual([403, 403, 403, 403, 403]);
      for (const mock of [m.initiate, m.finalize, m.attach, m.list, m.detach]) {
        expect(mock).not.toHaveBeenCalled();
      }
    });

    it("rejects a user API key", async () => {
      const app = createApp({
        ...SESSION_AUTH,
        authenticationMethod: "api_key",
      });
      const response = await app.request(
        `http://localhost/${PROJECT_ID}/ads/accounts`,
      );
      expect(response.status).toBe(403);
      expect(m.list).not.toHaveBeenCalled();
    });

    it("requires a Workspace context", async () => {
      const response = await createApp(SESSION_AUTH, null).request(
        `http://localhost/${PROJECT_ID}/ads/accounts`,
      );
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(m.list).not.toHaveBeenCalled();
    });
  });
});
