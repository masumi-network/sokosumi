import { Hono } from "hono";

import mountGetPkce from "./pkce/post.js";

const app = new Hono();

mountGetPkce(app);

export default app;
