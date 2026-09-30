import { OpenAPIHono } from "@hono/zod-openapi";
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
import { defaultValidationHook, type EnvVariables } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import type { WorkspaceContext } from "@/middleware/workspace";
import mountUpdateCampaign from "./accounts/[accountId]/campaigns/[campaignId]/patch.js";
import mountListCampaigns from "./accounts/[accountId]/campaigns/get.js";
import mountDeleteAccount from "./accounts/[accountId]/delete.js";
import mountListAccounts from "./accounts/get.js";
import mountAttachAccounts from "./accounts/post.js";
import mountFinalize from "./connections/finalize/post.js";
import mountInitiate from "./connections/initiate/post.js";

const m = vi.hoisted(() => ({
  requireSocialBetaAccess: vi.fn(),
  initiate: vi.fn(),
  finalize: vi.fn(),
  attach: vi.fn(),
  list: vi.fn(),
  detach: vi.fn(),
  campaigns: vi.fn(),
  updateCampaign: vi.fn(),
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
  listProjectAdCampaigns: m.campaigns,
  updateProjectAdCampaign: m.updateCampaign,
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
  mountListCampaigns(app);
  mountUpdateCampaign(app);
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

  describe("error mapping", () => {
    const initiate = () =>
      post(createApp(), "connections/initiate", { provider: "google_ads" });

    it("maps a missing Composio configuration to 503", async () => {
      m.initiate.mockRejectedValue(new ComposioConfigError("not configured"));
      expect((await initiate()).status).toBe(503);
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
