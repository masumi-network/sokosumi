import { OpenAPIHono } from "@hono/zod-openapi";

import mountPostUser from "./post.js";

const app = new OpenAPIHono();

mountPostUser(app);

export default app;
