import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { createNetworkScope } from "@/lib/db/network-scope";

import {
  type NetworkScopeVariables,
  networkScopeMiddleware,
} from "./network-scope";

describe("networkScopeMiddleware", () => {
  it("gives the request a Mainnet scope", async () => {
    const app = new Hono<{ Variables: NetworkScopeVariables }>();
    app.use(networkScopeMiddleware);
    app.get("/", (c) => c.text(c.var.networkScope.network));

    const response = await app.request("http://localhost/");

    expect(await response.text()).toBe("mainnet");
  });

  it("keeps the scope the request already has", async () => {
    const first = createNetworkScope("mainnet");
    const app = new Hono<{ Variables: NetworkScopeVariables }>();
    app.use(async (c, next) => {
      c.set("networkScope", first);
      await next();
    });
    app.use(networkScopeMiddleware);
    app.get("/", (c) => c.json(c.var.networkScope === first));

    const response = await app.request("http://localhost/");

    expect(await response.json()).toBe(true);
  });
});
