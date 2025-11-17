import { Hono } from "hono";
import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetAgentById from "./[id]/get";
import mountGetAgents from "./get";
import { OpenAPIHono } from "@hono/zod-openapi";
import { RequestIdVariables } from "hono/request-id";

// const app = new OpenAPIHonoWithAuth();
const app = new OpenAPIHono<{ Variables: RequestIdVariables }>();

mountGetAgents(app);
// mountGetAgentById(app);

export default app;
