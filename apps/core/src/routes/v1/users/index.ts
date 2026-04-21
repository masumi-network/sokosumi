import { OpenAPIHono } from "@hono/zod-openapi";

import userByIdRouter from "./[id]/index.js";
import usersRegisteredRouter from "./registered/index.js";

const app = new OpenAPIHono();

app.route("/registered", usersRegisteredRouter);
app.route("/:id", userByIdRouter);

export default app;
