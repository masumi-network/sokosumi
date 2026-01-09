import { OpenAPIHono } from "@hono/zod-openapi";

import usersMeRouter from "./me/index.js";
import mountPostUser from "./post.js";
import mountGetUserRegistered from "./registered/get.js";

const app = new OpenAPIHono();

mountPostUser(app);
mountGetUserRegistered(app);
app.route("/me", usersMeRouter);

export default app;
