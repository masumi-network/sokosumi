import { Hono } from "hono";
import { requestId } from "hono/request-id";
import { describe, expect, it } from "vitest";

import healthRouter from "./index.js";

describe("health route", () => {
  it("answers 200 without credentials", async () => {
    const app = new Hono();
    app.use(requestId());
    app.route("/health", healthRouter);

    const response = await app.request("http://localhost/health");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { status: "ok" },
      meta: { requestId: expect.any(String) },
    });
  });
});
