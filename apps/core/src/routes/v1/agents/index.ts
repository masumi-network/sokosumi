import { OpenAPIHono } from "@hono/zod-openapi";

import mountGetAgentById from "./[id]/get.js";
import mountGetAgents from "./get.js";

const app = new OpenAPIHono();

mountGetAgents(app);
mountGetAgentById(app);

export default app;
