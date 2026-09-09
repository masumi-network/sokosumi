import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { matchedRouteTemplate, UNMATCHED_ROUTE } from "./route-template";

function templateFor(
  build: (app: Hono) => void,
  path: string,
): Promise<string> {
  return new Promise((resolve) => {
    const app = new Hono();
    app.use("*", async (c, next) => {
      resolve(matchedRouteTemplate(c));
      return await next();
    });
    build(app);
    void app.request(`http://localhost${path}`);
  });
}

describe("matchedRouteTemplate", () => {
  it("returns the template, not the concrete path", async () => {
    const template = await templateFor(
      (app) => app.get("/v1/share/:token", (c) => c.text("ok")),
      "/v1/share/share-capability-token",
    );

    expect(template).toBe("/v1/share/:token");
  });

  it("skips a wildcard registered below the route it wraps", async () => {
    const template = await templateFor((app) => {
      const v1 = new Hono();
      v1.get("/share/:token", (c) => c.text("ok"));
      v1.use("*", async (_c, next) => await next());
      app.route("/v1", v1);
    }, "/v1/share/share-capability-token");

    expect(template).toBe("/v1/share/:token");
  });

  it("reports UNMATCHED instead of an unknown raw path", async () => {
    const template = await templateFor(
      () => {},
      "/v1/not-a-route/some-secret-slug",
    );

    expect(template).toBe(UNMATCHED_ROUTE);
  });

  it("reports UNMATCHED when the hono internal is unreadable", () => {
    // matchedRoutes reads an untyped hono internal. Observability must not
    // 500 a request if that internal ever moves.
    const brokenContext = {
      req: {},
    } as unknown as Parameters<typeof matchedRouteTemplate>[0];

    expect(matchedRouteTemplate(brokenContext)).toBe(UNMATCHED_ROUTE);
  });
});
