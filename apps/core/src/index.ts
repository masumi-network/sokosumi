import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import type { RequestIdVariables } from "hono/request-id";
import { requestId } from "hono/request-id";

import { notFound } from "./helpers/error";
import { ok } from "./helpers/response";

const app = new Hono<{ Variables: RequestIdVariables }>();

app.use(logger());
app.use(requestId());
app.use("*", cors());

app.notFound(() => {
  throw notFound();
});

// Mount API v1 routes
app.get("/v1", async (c) => {
  // Lazy load the repository to avoid module instantiation issues with Bun on Vercel
  const { agentRepository } = await import("@sokosumi/database/repositories");
  const agents = await agentRepository.getAgentsWithRelations();

  return ok(
    c,
    agents.map((agent) => {
      return {
        id: agent.id,
        name: agent.name,
      };
    }),
  );
});

export default {
  port: Bun.env.PORT ?? 3000,
  fetch: app.fetch,
};
