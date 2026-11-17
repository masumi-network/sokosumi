import { Hono } from "hono";
import { requestId } from "hono/request-id";

import { coreEvlogMiddleware } from "@/lib/evlog";

/**
 * Runs `work` inside a request that has Core's wide event, and returns once
 * the response is sent and the event emitted. For asserting what lands on the
 * request's event.
 */
export async function inRequest(work: () => Promise<unknown>): Promise<void> {
  const app = new Hono();
  app.use(requestId());
  app.use(coreEvlogMiddleware());
  app.get("/v1/example", async (c) => {
    await work();
    return c.json({ ok: true });
  });
  const response = await app.request("http://localhost/v1/example");
  if (response.status !== 200) {
    throw new Error(`inRequest answered ${response.status}`);
  }
}
