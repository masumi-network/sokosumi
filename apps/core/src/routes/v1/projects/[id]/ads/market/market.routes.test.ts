import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ComposioApiError,
  ComposioConfigError,
} from "@/clients/composio.client";
import { ComposioToolError } from "@/clients/social-post-providers/tools";
import { conflict, forbidden, notFound } from "@/helpers/error";
import { defaultValidationHook, type EnvVariables } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import type { WorkspaceContext } from "@/middleware/workspace";
import mountListAds from "./ads/get.js";
import mountGetMarket from "./get.js";
import mountListKeywords from "./keywords/get.js";
import mountPutMarket from "./put.js";

const m = vi.hoisted(() => ({
  requireSocialBetaAccess: vi.fn(),
  getProfile: vi.fn(),
  setProfile: vi.fn(),
  listKeywords: vi.fn(),
  listAds: vi.fn(),
}));

vi.mock("@/helpers/social-beta-access", () => ({
  requireSocialBetaAccess: m.requireSocialBetaAccess,
}));
vi.mock("@/services/project-ad-market.service", () => ({
  getProjectAdMarketProfile: m.getProfile,
  setProjectAdMarketProfile: m.setProfile,
  listProjectAdMarketKeywords: m.listKeywords,
  listProjectAdMarketAds: m.listAds,
}));
vi.mock("@/lib/db/prisma", () => ({ default: {} }));

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "user_123";
const BASE = `http://localhost/${PROJECT_ID}/ads/market`;

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

const profile = {
  keywords: ["running shoes"],
  countryCode: "DE",
  languageCode: "de",
  updatedAt: new Date("2026-10-01T10:00:00.000Z"),
};
const keywordsResult = {
  keywords: [
    {
      keyword: "running shoes",
      searchVolume: 5400,
      trend: [{ year: 2026, month: 8, searchVolume: 6000 }],
      competition: "HIGH",
      competitionIndex: 87,
      cpc: 1.25,
      lowTopOfPageBid: 0.5,
      highTopOfPageBid: 2.1,
    },
    {
      keyword: "no data",
      searchVolume: null,
      trend: [],
      competition: null,
      competitionIndex: null,
      cpc: null,
      lowTopOfPageBid: null,
      highTopOfPageBid: null,
    },
  ],
  fetchedAt: new Date("2026-10-01T11:00:00.000Z"),
};

const adsResult = {
  status: "ready",
  ads: [
    {
      creativeId: "CR1",
      advertiserId: "AR1",
      advertiserName: "Acme Shoes",
      format: "image",
      previewImage: {
        url: "https://tpc.googlesyndication.com/archive/simgad/1",
        width: 300,
        height: 250,
      },
      previewUrl:
        "https://adstransparency.google.com/advertiser/AR1/creative/CR1",
      firstShown: "2026-09-01T08:00:00.000Z",
      lastShown: "2026-09-30T10:30:00.000Z",
      verified: true,
    },
    {
      creativeId: "CR2",
      advertiserId: "AR2",
      advertiserName: "Text Only",
      format: "text",
      previewImage: null,
      previewUrl: null,
      firstShown: null,
      lastShown: null,
      verified: false,
    },
  ],
  fetchedAt: new Date("2026-10-01T11:00:00.000Z"),
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
  mountGetMarket(app);
  mountPutMarket(app);
  mountListKeywords(app);
  mountListAds(app);
  return app;
}

function put(app: ReturnType<typeof createApp>, body: unknown) {
  return app.request(BASE, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validBody = {
  keywords: ["running shoes"],
  countryCode: "DE",
  languageCode: "de",
};

describe("Project ads market routes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    m.requireSocialBetaAccess.mockResolvedValue(undefined);
    m.getProfile.mockResolvedValue(profile);
    m.setProfile.mockResolvedValue(profile);
    m.listKeywords.mockResolvedValue(keywordsResult);
    m.listAds.mockResolvedValue(adsResult);
  });

  describe("profile", () => {
    it("returns the profile", async () => {
      const response = await createApp().request(BASE);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        data: {
          profile: {
            keywords: ["running shoes"],
            countryCode: "DE",
            languageCode: "de",
            updatedAt: "2026-10-01T10:00:00.000Z",
          },
        },
      });
      expect(m.getProfile).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
      });
    });

    it("returns a null profile before one is saved", async () => {
      m.getProfile.mockResolvedValue(null);
      const response = await createApp().request(BASE);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ data: { profile: null } });
    });

    it("saves a valid profile", async () => {
      const response = await put(createApp(), validBody);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        data: { profile: { countryCode: "DE" } },
      });
      expect(m.setProfile).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        ...validBody,
      });
    });

    it("trims keywords", async () => {
      await put(createApp(), { ...validBody, keywords: ["  shoes  "] });
      expect(m.setProfile).toHaveBeenCalledWith(
        expect.objectContaining({ keywords: ["shoes"] }),
      );
    });

    it.each([
      ["no keywords", { ...validBody, keywords: [] }],
      [
        "eleven keywords",
        {
          ...validBody,
          keywords: Array.from({ length: 11 }, (_, i) => `k${i}`),
        },
      ],
      ["a blank keyword", { ...validBody, keywords: ["   "] }],
      ["an 81-character keyword", { ...validBody, keywords: ["a".repeat(81)] }],
      ["an unknown country", { ...validBody, countryCode: "ZZ" }],
      ["a lowercase country", { ...validBody, countryCode: "de" }],
      ["an unknown language", { ...validBody, languageCode: "xx" }],
      ["a missing language", { keywords: ["a"], countryCode: "DE" }],
    ])("rejects %s with 422", async (_name, body) => {
      const response = await put(createApp(), body);
      expect(response.status).toBe(422);
      expect(m.setProfile).not.toHaveBeenCalled();
    });

    it("passes a closed Project conflict through as 409", async () => {
      m.setProfile.mockRejectedValue(conflict("closed"));
      expect((await put(createApp(), validBody)).status).toBe(409);
    });

    it("keeps a foreign Project 404", async () => {
      m.getProfile.mockRejectedValue(notFound("Project not found"));
      expect((await createApp().request(BASE)).status).toBe(404);
    });
  });

  describe("keywords", () => {
    const url = `${BASE}/keywords`;

    it("returns keywords with nulls intact", async () => {
      const response = await createApp().request(url);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        data: {
          fetchedAt: "2026-10-01T11:00:00.000Z",
          keywords: [
            { keyword: "running shoes", searchVolume: 5400, cpc: 1.25 },
            { keyword: "no data", searchVolume: null, competition: null },
          ],
        },
      });
      expect(m.listKeywords).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
      });
    });

    it("has no currency field: money is documented as USD", async () => {
      const body = await (await createApp().request(url)).json();
      expect(body.data).not.toHaveProperty("currency");
    });

    it("is 404 without a market profile", async () => {
      m.listKeywords.mockRejectedValue(notFound("Market profile not set"));
      expect((await createApp().request(url)).status).toBe(404);
    });

    it.each([
      [
        "Composio tool error",
        new ComposioToolError({
          message: "refused",
          providerMessage: "secret detail",
        }),
        502,
      ],
      ["Composio API error", new ComposioApiError(500, undefined, "down"), 502],
      ["missing configuration", new ComposioConfigError("not configured"), 503],
      ["unexpected error", new Error("boom"), 500],
    ])("maps %s to %i", async (_name, error, status) => {
      m.listKeywords.mockRejectedValue(error);
      const response = await createApp().request(url);
      expect(response.status).toBe(status);
      expect(await response.text()).not.toContain("secret detail");
    });
  });

  describe("ads", () => {
    const url = `${BASE}/ads`;

    it("returns ads with preview images and nulls intact", async () => {
      const response = await createApp().request(url);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        data: {
          status: "ready",
          fetchedAt: "2026-10-01T11:00:00.000Z",
          ads: [
            {
              creativeId: "CR1",
              advertiserName: "Acme Shoes",
              format: "image",
              previewImage: { width: 300, height: 250 },
              lastShown: "2026-09-30T10:30:00.000Z",
            },
            {
              creativeId: "CR2",
              previewImage: null,
              previewUrl: null,
              lastShown: null,
            },
          ],
        },
      });
      expect(m.listAds).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
      });
    });

    it("returns an empty list", async () => {
      m.listAds.mockResolvedValue({ ...adsResult, ads: [] });
      const response = await createApp().request(url);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ data: { ads: [] } });
    });

    it.each(["gathering", "failed"])(
      "returns status %s with a null fetchedAt before the first snapshot",
      async (status) => {
        m.listAds.mockResolvedValue({ status, ads: [], fetchedAt: null });
        const response = await createApp().request(url);
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
          data: { status, ads: [], fetchedAt: null },
        });
      },
    );

    it("is 404 without a market profile or for a foreign Project", async () => {
      m.listAds.mockRejectedValue(notFound("Market profile not set"));
      expect((await createApp().request(url)).status).toBe(404);
    });

    it.each([
      [
        "Composio tool error",
        new ComposioToolError({
          message: "refused",
          providerMessage: "secret detail",
        }),
        502,
      ],
      ["Composio API error", new ComposioApiError(500, undefined, "down"), 502],
      ["missing configuration", new ComposioConfigError("not configured"), 503],
      ["unexpected error", new Error("boom"), 500],
    ])("maps %s to %i", async (_name, error, status) => {
      m.listAds.mockRejectedValue(error);
      const response = await createApp().request(url);
      expect(response.status).toBe(status);
      expect(await response.text()).not.toContain("secret detail");
    });
  });

  describe("access", () => {
    it("denies users outside the beta before any work", async () => {
      m.requireSocialBetaAccess.mockRejectedValue(forbidden("beta only"));
      const app = createApp();
      const responses = await Promise.all([
        app.request(BASE),
        put(app, validBody),
        app.request(`${BASE}/keywords`),
        app.request(`${BASE}/ads`),
      ]);
      expect(responses.map((r) => r.status)).toEqual([403, 403, 403, 403]);
      for (const mock of [
        m.getProfile,
        m.setProfile,
        m.listKeywords,
        m.listAds,
      ]) {
        expect(mock).not.toHaveBeenCalled();
      }
    });

    it("rejects a user API key", async () => {
      const app = createApp({
        ...SESSION_AUTH,
        authenticationMethod: "api_key",
      });
      expect((await app.request(`${BASE}/keywords`)).status).toBe(403);
      expect((await app.request(`${BASE}/ads`)).status).toBe(403);
      expect(m.listKeywords).not.toHaveBeenCalled();
      expect(m.listAds).not.toHaveBeenCalled();
    });

    it("requires a Workspace context", async () => {
      const response = await createApp(SESSION_AUTH, null).request(BASE);
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(m.getProfile).not.toHaveBeenCalled();
    });
  });
});
