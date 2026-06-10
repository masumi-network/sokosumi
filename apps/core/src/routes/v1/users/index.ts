import { OpenAPIHono } from "@hono/zod-openapi";

import userByIdRouter from "./[id]/index.js";
import checkEmailsRouter from "./check-emails/index.js";
import usersRegisteredRouter from "./registered/index.js";

const app = new OpenAPIHono();

app.route("/registered", usersRegisteredRouter);
app.route("/check-emails", checkEmailsRouter);
app.route("/:id", userByIdRouter);

export default app;
