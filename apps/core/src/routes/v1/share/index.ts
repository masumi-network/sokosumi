import { OpenAPIHono } from "@hono/zod-openapi";

import mountGetSharedResourceByToken from "./[token]/get.js";

const app = new OpenAPIHono();

mountGetSharedResourceByToken(app);

export default app;
