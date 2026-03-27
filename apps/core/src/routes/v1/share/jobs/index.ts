import { OpenAPIHono } from "@hono/zod-openapi";

import mountGetSharedJobByToken from "./[token]/get.js";

const app = new OpenAPIHono();

mountGetSharedJobByToken(app);

export default app;
