import { OpenAPIHono } from "@hono/zod-openapi";
import { Hono } from "hono";
import { RequestIdVariables } from "hono/request-id";

import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetAgentById from "./[id]/get";
import mountGetAgents from "./get";
import { ok } from "@/helpers/response";

const app = new OpenAPIHonoWithAuth();

// mountGetAgents(app);
// mountGetAgentById(app);

app.route("/agents", async (c) => {
  return ok(c, { message: "Hello, world!" });
});
// app.route("/agents/:id", mountGetAgentById);
export default app;
