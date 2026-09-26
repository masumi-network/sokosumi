import { OpenAPIHono } from "@hono/zod-openapi";

import { defaultValidationHook } from "@/lib/hono";
import {
  type AgentGrantContext,
  requireAgentGrant,
} from "@/routes/image-studio-agent/authorize";

import mountRecordInitialTurn from "./sessions-initial-turn-post.js";
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
 * Holding it to the contract means its failures too: `defaultValidationHook`
 * turns a schema failure into the documented envelope, and the grant check
 * throws rather than writing its own body, so a 401 or 503 from here looks
 * like a 401 or 503 from anywhere else in `/v1`.
 *
 * Authenticated by agent grant rather than an interactive session: the caller
 * is the studio agent, running outside Core.
 */
const app = new OpenAPIHono<{
  Variables: { agentGrant: AgentGrantContext };
}>({ defaultHook: defaultValidationHook });

app.use("*", async (c, next) => {
  c.set("agentGrant", await requireAgentGrant(c.req.raw));
  await next();
});

mountRegisterSession(app);
mountRecordInitialTurn(app);

export default app;
