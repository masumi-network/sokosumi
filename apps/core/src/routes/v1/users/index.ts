import { OpenAPIHono } from "@hono/zod-openapi";

import usersByIdRouter from "./[id]/index.js";
import usersMagicLinkRouter from "./magic-link/index.js";
import usersMeRouter from "./me/index.js";
import usersRegisteredRouter from "./registered/index.js";

const app = new OpenAPIHono();

app.route("/magic-link", usersMagicLinkRouter);
app.route("/me", usersMeRouter);
app.route("/registered", usersRegisteredRouter);
app.route("/", usersByIdRouter);

export default app;
