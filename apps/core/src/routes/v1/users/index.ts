import { OpenAPIHono } from "@hono/zod-openapi";

import usersMeRouter from "./me/index.js";
import mountPostUser from "./post.js";

const app = new OpenAPIHono();

mountPostUser(app);
app.route("/me", usersMeRouter);

export default app;
