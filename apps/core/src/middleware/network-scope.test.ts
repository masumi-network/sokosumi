import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { networkScopeMiddleware, requireNetworkScope } from "./network-scope";

function createApp() {
  const app = new Hono();
  app.onError((error, c) => c.text(error.message, 500));
  return app;
}

describe("networkScopeMiddleware", () => {
  it("gives the request a Mainnet scope", async () => {
    const app = createApp();
    app.use(networkScopeMiddleware);
    app.get("/", (c) => c.text(requireNetworkScope(c).network));

    const response = await app.request("http://localhost/");

    expect(await response.text()).toBe("mainnet");
  });

  it("gives each request its own scope", async () => {
    const scopes: unknown[] = [];
    const app = createApp();
    app.use(networkScopeMiddleware);
    app.get("/", (c) => {
      scopes.push(requireNetworkScope(c));
      return c.body(null);
    });

    await app.request("http://localhost/");
    await app.request("http://localhost/");

    expect(scopes[0]).not.toBe(scopes[1]);
  });
});

describe("requireNetworkScope", () => {
  it("throws on a router that did not run the middleware", async () => {
    const app = createApp();
    app.get("/", (c) => c.text(requireNetworkScope(c).network));

    const response = await app.request("http://localhost/");

    expect(response.status).toBe(500);
    expect(await response.text()).toBe("This request has no Network scope");
  });
});
