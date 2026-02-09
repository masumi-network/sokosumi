import { OpenAPIHono } from "@hono/zod-openapi";

import usersMeRouter from "./me/index.js";
import mountPostUser from "./post.js";
import usersRegisteredRouter from "./registered/index.js";

const app = new OpenAPIHono();

mountPostUser(app);
app.route("/me", usersMeRouter);
app.route("/registered", usersRegisteredRouter);

export default app;
