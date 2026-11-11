import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { cmoLockedProjectId, cmoProjectLock } from "./cmo-project-lock";

const CMO_PROJECT = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";
const ORDINARY_PROJECT = "aaaaaaaa-aaaa-4aaa-8aaa-000000000002";

vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBot: {
      findFirst: async ({ where }: { where: { projectId: string } }) =>
        where.projectId === CMO_PROJECT ? { id: "cuso" } : null,
    },
  },
}));

const projectsRouter = (await import("./index")).default;

/** Every write route of the projects router, as `METHOD /path`. */
const writeRoutes = [
  ...new Set(
    projectsRouter.routes
      .filter(({ method }) => !["GET", "ALL"].includes(method))
      .map(({ method, path }) => `${method} ${path}`),
  ),
];

function lockedRoute(route: string) {
  const [method = "", path = ""] = route.split(" ");
  return cmoLockedProjectId(method, `/v1/projects${path}`) !== null;
}

describe("cmoLockedProjectId on the projects router", () => {
  it("leaves only Pin, Hide, Task links and reading POSTs open", () => {
    expect(writeRoutes.filter((route) => !lockedRoute(route)).sort()).toEqual(
      [
        "DELETE /:id/hide",
        "DELETE /:id/star",
        "DELETE /:id/tasks/:taskId",
        "POST /",
        "POST /:id/hide",
        "POST /:id/newsletter/issues/preview",
        "POST /:id/social-connections/:connectionId/statistics/refresh",
        "POST /:id/social-posts/:postId/statistics/refresh",
        "POST /:id/star",
        "POST /:id/tasks",
      ].sort(),
    );
  });

  it("locks every other write, each Ads action among them", () => {
    const locked = writeRoutes.filter(lockedRoute);
    expect(locked).toEqual(
      expect.arrayContaining([
        "PATCH /:id",
        "DELETE /:id",
        "PUT /:id/design-md",
        "POST /:id/social-posts",
        "PUT /:id/newsletter",
        "POST /:id/close",
        "POST /:id/close/retry",
        "POST /:id/close/cancel-owed",
        "POST /:id/jobs",
        "PUT /:id/image-studio/brand-kit",
        "POST /:id/ads/connections/initiate",
        "POST /:id/ads/connections/finalize",
        "POST /:id/ads/accounts",
        "DELETE /:id/ads/accounts/:accountId",
        "DELETE /:id/ads/connections/:adConnectionId",
        "POST /:id/ads/accounts/:accountId/campaigns",
        "PATCH /:id/ads/accounts/:accountId/campaigns/:campaignId",
        "PUT /:id/ads/accounts/:accountId/campaigns/:campaignId",
        "PUT /:id/ads/market",
      ]),
    );
  });

  it("never locks a read", () => {
    expect(cmoLockedProjectId("GET", `/v1/projects/${CMO_PROJECT}`)).toBe(null);
  });
});

describe("cmoProjectLock", () => {
  function app() {
    const hono = new Hono();
    hono.use("*", cmoProjectLock);
    hono.all("*", (c) => c.text("route reached"));
    hono.onError(errorHandler);
    return hono;
  }

  it.each([
    ["PATCH", ""],
    ["PUT", "/design-md"],
    ["POST", "/social-posts"],
    ["PUT", "/newsletter"],
    ["POST", "/close"],
  ])("answers %s %s on a CMO Project with 409", async (method, rest) => {
    const locked = await app().request(`/v1/projects/${CMO_PROJECT}${rest}`, {
      method,
    });
    expect(locked.status).toBe(409);
    expect(await locked.json()).toMatchObject({
      kind: "cmo_project_read_only",
    });

    const ordinary = await app().request(
      `/v1/projects/${ORDINARY_PROJECT}${rest}`,
      { method },
    );
    expect(ordinary.status).toBe(200);
  });

  it.each([
    ["POST", "/star"],
    ["POST", "/hide"],
    ["POST", "/tasks"],
    ["DELETE", "/tasks/aaaaaaaa-aaaa-4aaa-8aaa-0000000000aa"],
  ])("keeps %s %s open on a CMO Project", async (method, rest) => {
    const response = await app().request(`/v1/projects/${CMO_PROJECT}${rest}`, {
      method,
    });
    expect(response.status).toBe(200);
  });
});
