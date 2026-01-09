import { OpenAPIHono } from "@hono/zod-openapi";

import mountGetUserExists from "./exists/get.js";
import usersMeRouter from "./me/index.js";
import mountPostUser from "./post.js";

const app = new OpenAPIHono();

mountGetUserExists(app);
mountPostUser(app);
app.route("/me", usersMeRouter);

export default app;
