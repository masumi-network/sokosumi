import { OpenAPIHono } from "@hono/zod-openapi";

import {
  type AgentGrantContext,
  authorizeAgentGrant,
} from "@/routes/image-studio-agent/authorize";

import mountRegisterSession from "./sessions-post.js";

/**
 * The part of the image-studio agent surface that writes durable records.
 *
 * Mounted under `/v1` with validated OpenAPI schemas and the shared response
 * helpers, like every other Core data-access endpoint. The agent's read-only
 * and authorization calls remain on the older unversioned surface; this router
 * exists because recording a conversation persists a row, and that is held to
 * the documented contract rather than to the shape of its neighbours.
 *
 * Authenticated by agent grant rather than an interactive session: the caller
 * is the studio agent, running outside Core.
 */
const app = new OpenAPIHono<{
  Variables: { agentGrant: AgentGrantContext };
}>();

app.use("*", async (c, next) => {
  const context = await authorizeAgentGrant(c.req.raw);
  if (context instanceof Response) return context;
  c.set("agentGrant", context);
  await next();
});

mountRegisterSession(app);

export default app;
