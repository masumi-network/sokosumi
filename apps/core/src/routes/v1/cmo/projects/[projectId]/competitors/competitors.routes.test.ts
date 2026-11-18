import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const m = vi.hoisted(() => ({
  getCmoCompetitors: vi.fn(),
  addTrackedCompetitor: vi.fn(),
  updateTrackedCompetitor: vi.fn(),
  removeTrackedCompetitor: vi.fn(),
  addCompetitorMoveToStrategy: vi.fn(),
}));

vi.mock("@/services/cmo-competitors-overview.service", () => ({
  getCmoCompetitors: m.getCmoCompetitors,
}));
vi.mock("@/services/cmo-competitor-feed.service", () => ({
  addCompetitorMoveToStrategy: m.addCompetitorMoveToStrategy,
}));
vi.mock("@/services/cmo-competitors.service", () => ({
  addTrackedCompetitor: m.addTrackedCompetitor,
  updateTrackedCompetitor: m.updateTrackedCompetitor,
  removeTrackedCompetitor: m.removeTrackedCompetitor,
}));

import {
  CmoConflictError,
  CmoNotFoundError,
} from "@/services/cmo-cuso.service";

import cmoRouter from "../../../index";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const COMPETITOR_ID = "22222222-2222-4222-8222-222222222222";
const SIGNAL_ID = "33333333-3333-4333-8333-333333333333";
const ITEM_ID = "44444444-4444-4444-8444-444444444444";
const AT = new Date("2026-11-16T09:00:00Z");
const BASE = `/projects/${PROJECT_ID}/competitors`;

const CMO_TOKEN: AuthenticationContext = {
  actor: "user",
  userId: "user-1",
  organizationId: null,
  role: "user",
  authenticationMethod: "oauth",
  firstPartyClient: true,
  oauthClientId: "cmo-oauth-client",
};

function createApp(auth: AuthenticationContext = CMO_TOKEN) {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", auth);
    return await next();
  });
  app.route("/", cmoRouter);
  app.onError(errorHandler);
  return app;
}

const measure = {
  value: 12,
  sourceUrl: "https://www.instagram.com/calendly/",
  observedAt: AT,
};

const COMPETITORS = {
  competitors: [
    {
      id: COMPETITOR_ID,
      createdAt: AT,
      projectId: PROJECT_ID,
      name: "Calendly",
      websiteUrl: "https://calendly.com/",
      pricingUrl: "https://calendly.com/pricing",
      instagramHandle: "calendly",
      facebookHandle: null,
      source: "RESEARCH",
    },
  ],
  feed: {
    checkDay: "2026-11-16",
    savedAt: AT,
    items: [
      {
        id: ITEM_ID,
        competitorId: COMPETITOR_ID,
        facts: [
          {
            text: "Calendly raised Standard from $10 to $12.",
            signalIds: [SIGNAL_ID],
            support: "strong",
          },
        ],
        meaning: "Our Teams plan is now the cheaper one.",
        move: "Lead with the price per seat on LinkedIn next week.",
        big: true,
        addedToStrategyAt: null,
      },
    ],
    openQuestions: [],
  },
  limit: 5,
  mapPlayers: ["Calendly"],
  signals: [
    {
      id: SIGNAL_ID,
      competitorId: COMPETITOR_ID,
      kind: "PRICE_CHANGE",
      summary: "Standard plan $10 -> $12",
      observedAt: AT,
      sourceUrl: "https://calendly.com/pricing",
      sourceTitle: "Calendly pricing",
      sourcePublisher: "Calendly",
      quote: "$12",
    },
  ],
  scoreboard: [
    {
      competitorId: null,
      name: "acme.io",
      postsPerWeek: null,
      engagementPerPost: null,
      followers: null,
      followerGrowth: null,
    },
    {
      competitorId: COMPETITOR_ID,
      name: "Calendly",
      postsPerWeek: { ...measure, value: 3 },
      engagementPerPost: measure,
      followers: { ...measure, value: 40_000 },
      followerGrowth: null,
    },
  ],
  topPosts: [],
  check: {
    lastCheckedAt: AT,
    nextCheckAt: new Date("2026-11-23T09:00:00Z"),
    creditsPerCompetitor: 3,
    sources: {
      pages: { status: "ok", needs: null },
      news: { status: "ok", needs: null },
      ads: { status: "not_configured", needs: "Meta access is not set up." },
      social: { status: "not_connected", needs: "Connect Instagram." },
    },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  m.getCmoCompetitors.mockResolvedValue(COMPETITORS);
  m.addTrackedCompetitor.mockResolvedValue(undefined);
  m.updateTrackedCompetitor.mockResolvedValue(undefined);
  m.removeTrackedCompetitor.mockResolvedValue(undefined);
  m.addCompetitorMoveToStrategy.mockResolvedValue({ turnId: "turn-1" });
});

describe("GET /cmo/projects/{projectId}/competitors", () => {
  it("returns the tab for the Cuso the path names", async () => {
    const response = await createApp().request(BASE);
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(m.getCmoCompetitors).toHaveBeenCalledWith({
      userId: "user-1",
      projectId: PROJECT_ID,
    });
    expect(data.competitors[0]).toEqual({
      id: COMPETITOR_ID,
      createdAt: AT.toISOString(),
      name: "Calendly",
      websiteUrl: "https://calendly.com/",
      pricingUrl: "https://calendly.com/pricing",
      instagramHandle: "calendly",
      facebookHandle: null,
      source: "RESEARCH",
    });
    expect(data.signals[0].quote).toBe("$12");
    expect(data.feed.items[0]).toMatchObject({
      id: ITEM_ID,
      big: true,
      facts: [{ signalIds: [SIGNAL_ID], support: "strong" }],
      addedToStrategyAt: null,
    });
    expect(data.scoreboard[1].followers).toEqual({
      value: 40_000,
      sourceUrl: "https://www.instagram.com/calendly/",
      observedAt: AT.toISOString(),
    });
    expect(data.check.sources.ads).toEqual({
      status: "not_configured",
      needs: "Meta access is not set up.",
    });
  });

  it("answers 404 without a Cuso", async () => {
    m.getCmoCompetitors.mockRejectedValue(
      new CmoNotFoundError("Cuso is not hired yet"),
    );
    expect((await createApp().request(BASE)).status).toBe(404);
  });
});

function send(method: string, path: string, body?: unknown) {
  return createApp().request(path, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("competitor writes", () => {
  it("adds one and answers with the tab", async () => {
    const response = await send("POST", BASE, {
      name: "Zcal",
      websiteUrl: "zcal.co",
    });
    expect(response.status).toBe(200);
    expect(m.addTrackedCompetitor).toHaveBeenCalledWith(
      { userId: "user-1", projectId: PROJECT_ID },
      { name: "Zcal", websiteUrl: "zcal.co" },
    );
    expect((await response.json()).data.limit).toBe(5);
  });

  it("answers 409 when the service refuses", async () => {
    m.addTrackedCompetitor.mockRejectedValue(
      new CmoConflictError("You can track 5 competitors. Remove one first."),
    );
    const response = await send("POST", BASE, { name: "Zcal" });
    expect(response.status).toBe(409);
    expect((await response.json()).message).toBe(
      "You can track 5 competitors. Remove one first.",
    );
  });

  it("refuses a write from another client than CMO", async () => {
    const response = await createApp({
      ...CMO_TOKEN,
      oauthClientId: "another-client",
    }).request(BASE, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Zcal" }),
    });
    expect(response.status).toBe(403);
    expect(m.addTrackedCompetitor).not.toHaveBeenCalled();
  });

  it("answers 422 for a competitor without a name", async () => {
    expect((await send("POST", BASE, { name: " " })).status).toBe(422);
    expect(m.addTrackedCompetitor).not.toHaveBeenCalled();
  });

  it("changes one, passing a cleared field as null", async () => {
    const response = await send("PATCH", `${BASE}/${COMPETITOR_ID}`, {
      pricingUrl: null,
      instagramHandle: "@calendly",
    });
    expect(response.status).toBe(200);
    expect(m.updateTrackedCompetitor).toHaveBeenCalledWith(
      { userId: "user-1", projectId: PROJECT_ID },
      COMPETITOR_ID,
      { pricingUrl: null, instagramHandle: "@calendly" },
    );
  });

  it("removes one", async () => {
    const response = await send("DELETE", `${BASE}/${COMPETITOR_ID}`);
    expect(response.status).toBe(200);
    expect(m.removeTrackedCompetitor).toHaveBeenCalledWith(
      { userId: "user-1", projectId: PROJECT_ID },
      COMPETITOR_ID,
    );
  });

  it("sends a move to the strategy and answers with the tab", async () => {
    const response = await send("POST", `${BASE}/feed/${ITEM_ID}/strategy`);
    expect(response.status).toBe(200);
    expect(m.addCompetitorMoveToStrategy).toHaveBeenCalledWith(
      { userId: "user-1", projectId: PROJECT_ID },
      ITEM_ID,
    );
  });

  it("answers 409 for a move already in the strategy", async () => {
    m.addCompetitorMoveToStrategy.mockRejectedValue(
      new CmoConflictError("This move is already in the strategy"),
    );
    const response = await send("POST", `${BASE}/feed/${ITEM_ID}/strategy`);
    expect(response.status).toBe(409);
  });

  it("answers 404 for a competitor of another Project", async () => {
    m.removeTrackedCompetitor.mockRejectedValue(
      new CmoNotFoundError("Competitor not found"),
    );
    expect((await send("DELETE", `${BASE}/${COMPETITOR_ID}`)).status).toBe(404);
  });
});
