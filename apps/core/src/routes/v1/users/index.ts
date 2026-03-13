import { OpenAPIHono } from "@hono/zod-openapi";

import usersMagicLinkRouter from "./magic-link/index.js";
import usersMeRouter from "./me/index.js";
import usersRegisteredRouter from "./registered/index.js";

const app = new OpenAPIHono();

app.route("/magic-link", usersMagicLinkRouter);
app.route("/me", usersMeRouter);
app.route("/registered", usersRegisteredRouter);

export default app;
