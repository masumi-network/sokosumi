import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { conflict, notFound, unprocessableEntity } from "@/helpers/error";
import { errorHandler } from "@/helpers/error-handler";
import { defaultValidationHook, type EnvVariables } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import type { WorkspaceContext } from "@/middleware/workspace";
import { expectCoreLog } from "@/test/core-log";

const m = vi.hoisted(() => ({
  requireProjectAccess: vi.fn(),
  requireNotCmoProject: vi.fn(),
  getProjectCompetitors: vi.fn(),
  addTrackedCompetitor: vi.fn(),
  updateTrackedCompetitor: vi.fn(),
  removeTrackedCompetitor: vi.fn(),
  setCompetitorChecks: vi.fn(),
  runProjectCompetitorCheck: vi.fn(),
  suggestCompetitors: vi.fn(),
}));

vi.mock("@/lib/image-studio/access", () => ({
  requireProjectAccess: m.requireProjectAccess,
}));
vi.mock("@/services/cmo-cuso.service", () => ({
  requireNotCmoProject: m.requireNotCmoProject,
}));
vi.mock("@/services/competitors-overview.service", () => ({
  getProjectCompetitors: m.getProjectCompetitors,
}));
vi.mock("@/services/competitors.service", () => ({
  addTrackedCompetitor: m.addTrackedCompetitor,
  updateTrackedCompetitor: m.updateTrackedCompetitor,
  removeTrackedCompetitor: m.removeTrackedCompetitor,
  setCompetitorChecks: m.setCompetitorChecks,
}));
vi.mock("@/services/competitor-suggestions.service", () => ({
  suggestCompetitors: m.suggestCompetitors,
}));
vi.mock("@/services/competitor-check.service", async (original) => ({
  ...(await original<typeof import("@/services/competitor-check.service")>()),
  runProjectCompetitorCheck: m.runProjectCompetitorCheck,
}));

import { cmoProjectLock } from "../../cmo-project-lock";
import mountRemove from "./[competitorId]/delete";
import mountUpdate from "./[competitorId]/patch";
import mountRunCheck from "./check/post";
import mountSetChecks from "./checks/put";
import mountGet from "./get";
import mountAdd from "./post";
import mountSuggest from "./suggestions/post";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const COMPETITOR_ID = "33333333-3333-4333-8333-333333333333";
const AT = new Date("2026-11-16T09:00:00Z");
const BASE = `http://localhost/projects/${PROJECT_ID}/competitors`;
const AUTH: AuthenticationContext = {
  actor: "user",
  userId: "user_1",
  organizationId: "organization_1",
  role: "user",
  authenticationMethod: "session",
};
const WORKSPACE: WorkspaceContext = {
  workspaceId: WORKSPACE_ID,
  userId: "user_1",
  organizationId: "organization_1",
};
const source = { status: "ok", needs: null };
const PAGE = {
  competitors: [
    {
      id: COMPETITOR_ID,
      createdAt: AT,
      projectId: PROJECT_ID,
      name: "Calendly",
      websiteUrl: "https://calendly.com/",
      pricingUrl: null,
      instagramHandle: null,
      facebookHandle: null,
      source: "MEMBER",
    },
  ],
  feed: null,
  limit: 5,
  signals: [],
  scoreboard: [],
  topPosts: [],
  check: {
    on: false,
    lastCheckedAt: null,
    nextCheckAt: null,
    creditsPerCompetitor: 3,
    sources: { pages: source, news: source, ads: source, social: source },
  },
};

function createApp() {
  const app = new OpenAPIHono<EnvVariables>({
    defaultHook: defaultValidationHook,
  });
  app.use("*", async (c, next) => {
    c.set("requestId", "competitors_test");
    c.set("isAuthenticated", true);
    c.set("authContext", AUTH);
    c.set("workspaceContext", WORKSPACE);
    await next();
  });
  const projects = new OpenAPIHono<EnvVariables>({
    defaultHook: defaultValidationHook,
  });
  projects.use("*", cmoProjectLock);
  mountGet(projects);
  mountAdd(projects);
  mountUpdate(projects);
  mountRemove(projects);
  mountSetChecks(projects);
  mountRunCheck(projects);
  mountSuggest(projects);
  app.route("/projects", projects);
  app.onError(errorHandler);
  return app;
}

function send(method: string, path: string, body?: unknown) {
  return createApp().request(path, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  m.requireProjectAccess.mockResolvedValue({ projectId: PROJECT_ID });
  m.getProjectCompetitors.mockResolvedValue(PAGE);
  m.runProjectCompetitorCheck.mockResolvedValue("checked");
});

describe("a Project's competitors", () => {
  it("returns the page to a member of the Project's workspace", async () => {
    const response = await send("GET", BASE);
    expect(response.status).toBe(200);
    expect(m.requireProjectAccess).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      userId: "user_1",
    });
    const { data } = await response.json();
    expect(data.competitors[0]).toEqual({
      id: COMPETITOR_ID,
      createdAt: AT.toISOString(),
      name: "Calendly",
      websiteUrl: "https://calendly.com/",
      pricingUrl: null,
      instagramHandle: null,
      facebookHandle: null,
      source: "MEMBER",
    });
    expect(data.check).toMatchObject({ on: false, creditsPerCompetitor: 3 });
  });

  it("answers 404 for a Project the caller cannot reach, and writes nothing", async () => {
    m.requireProjectAccess.mockRejectedValue(notFound("Project not found"));
    expect((await send("GET", BASE)).status).toBe(404);
    expect((await send("POST", BASE, { name: "Zcal" })).status).toBe(404);
    expect((await send("PUT", `${BASE}/checks`, { on: true })).status).toBe(
      404,
    );
    expect((await send("POST", `${BASE}/check`)).status).toBe(404);
    expect(m.addTrackedCompetitor).not.toHaveBeenCalled();
    expect(m.setCompetitorChecks).not.toHaveBeenCalled();
    expect(m.runProjectCompetitorCheck).not.toHaveBeenCalled();
  });

  it("adds, changes and removes a competitor", async () => {
    expect(
      (await send("POST", BASE, { name: "Zcal", websiteUrl: "zcal.co" }))
        .status,
    ).toBe(200);
    expect(m.addTrackedCompetitor).toHaveBeenCalledWith(PROJECT_ID, {
      name: "Zcal",
      websiteUrl: "zcal.co",
    });
    expect(
      (await send("PATCH", `${BASE}/${COMPETITOR_ID}`, { pricingUrl: null }))
        .status,
    ).toBe(200);
    expect(m.updateTrackedCompetitor).toHaveBeenCalledWith(
      PROJECT_ID,
      COMPETITOR_ID,
      { pricingUrl: null },
    );
    expect((await send("DELETE", `${BASE}/${COMPETITOR_ID}`)).status).toBe(200);
    expect(m.removeTrackedCompetitor).toHaveBeenCalledWith(
      PROJECT_ID,
      COMPETITOR_ID,
    );
  });

  it("answers 409 with the service's words when the limit is reached", async () => {
    m.addTrackedCompetitor.mockRejectedValue(
      conflict("You can track 5 competitors. Remove one first."),
    );
    const response = await send("POST", BASE, { name: "Zcal" });
    expect(response.status).toBe(409);
    expect((await response.json()).message).toBe(
      "You can track 5 competitors. Remove one first.",
    );
  });

  it("answers 422 for a competitor without a name", async () => {
    expect((await send("POST", BASE, { name: " " })).status).toBe(422);
    expect(m.addTrackedCompetitor).not.toHaveBeenCalled();
  });

  it("turns the weekly check on and off", async () => {
    expect((await send("PUT", `${BASE}/checks`, { on: true })).status).toBe(
      200,
    );
    expect(m.setCompetitorChecks).toHaveBeenCalledWith(PROJECT_ID, true);
    expect((await send("PUT", `${BASE}/checks`, { on: false })).status).toBe(
      200,
    );
    expect(m.setCompetitorChecks).toHaveBeenLastCalledWith(PROJECT_ID, false);
    expect((await send("PUT", `${BASE}/checks`, {})).status).toBe(422);
  });

  it("starts the first check when the weekly check is turned on, not when off", async () => {
    m.runProjectCompetitorCheck.mockResolvedValue("checked");
    await send("PUT", `${BASE}/checks`, { on: false });
    expect(m.runProjectCompetitorCheck).not.toHaveBeenCalled();
    await send("PUT", `${BASE}/checks`, { on: true });
    expect(m.runProjectCompetitorCheck).toHaveBeenCalledWith(PROJECT_ID);
  });

  it("turns the check on even when the first check fails", async () => {
    const warnings = expectCoreLog(
      "warn",
      "The first competitor check did not run",
    );
    m.runProjectCompetitorCheck.mockRejectedValue(new Error("site down"));
    expect((await send("PUT", `${BASE}/checks`, { on: true })).status).toBe(
      200,
    );
    await vi.waitFor(() => expect(warnings).toHaveLength(1));
    expect(JSON.stringify(warnings)).not.toContain("site down");
  });

  it("runs the check that is due and answers with how it went", async () => {
    m.runProjectCompetitorCheck.mockResolvedValue("unfunded");
    const response = await send("POST", `${BASE}/check`);
    expect(response.status).toBe(200);
    expect(m.runProjectCompetitorCheck).toHaveBeenCalledWith(PROJECT_ID);
    const { data } = await response.json();
    expect(data.outcome).toBe("unfunded");
    expect(data.competitors.limit).toBe(5);
  });

  it("suggests competitors to pick from and adds none", async () => {
    const suggestions = [
      {
        name: "Calendly",
        websiteUrl: "https://calendly.com/",
        why: "Scheduling links for teams.",
      },
    ];
    m.suggestCompetitors.mockResolvedValue(suggestions);
    const response = await send("POST", `${BASE}/suggestions`);
    expect(response.status).toBe(200);
    expect(m.suggestCompetitors).toHaveBeenCalledWith(PROJECT_ID);
    expect((await response.json()).data).toEqual({ suggestions });
    expect(m.addTrackedCompetitor).not.toHaveBeenCalled();
  });

  it("answers 422 with the service's words for a Project without a website", async () => {
    m.suggestCompetitors.mockRejectedValue(
      unprocessableEntity("Add the project's website first."),
    );
    const response = await send("POST", `${BASE}/suggestions`);
    expect(response.status).toBe(422);
    expect((await response.json()).message).toBe(
      "Add the project's website first.",
    );
  });

  it("passes a picked suggestion on as suggested", async () => {
    await send("POST", BASE, {
      name: "Calendly",
      websiteUrl: "https://calendly.com/",
      suggested: true,
    });
    expect(m.addTrackedCompetitor).toHaveBeenCalledWith(PROJECT_ID, {
      name: "Calendly",
      websiteUrl: "https://calendly.com/",
      suggested: true,
    });
  });

  it("stays readable and refuses every write on a CMO Project", async () => {
    m.requireNotCmoProject.mockRejectedValue(
      conflict("This Project is managed by CMO. Change it in CMO.", {
        kind: "cmo_project_read_only",
      }),
    );
    expect((await send("GET", BASE)).status).toBe(200);
    const refused = await Promise.all([
      send("POST", BASE, { name: "Zcal" }),
      send("PATCH", `${BASE}/${COMPETITOR_ID}`, { name: "Z" }),
      send("DELETE", `${BASE}/${COMPETITOR_ID}`),
      send("PUT", `${BASE}/checks`, { on: true }),
      send("POST", `${BASE}/check`),
    ]);
    for (const response of refused) {
      expect(response.status).toBe(409);
      expect((await response.json()).kind).toBe("cmo_project_read_only");
    }
    expect(m.addTrackedCompetitor).not.toHaveBeenCalled();
    expect(m.setCompetitorChecks).not.toHaveBeenCalled();
    expect(m.runProjectCompetitorCheck).not.toHaveBeenCalled();
  });
});
