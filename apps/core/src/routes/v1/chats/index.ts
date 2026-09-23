import { OpenAPIHono } from "@hono/zod-openapi";

import invitationsRouter from "./invitations/index.js";
import roomsRouter from "./rooms/index.js";
import threadsRouter from "./threads/index.js";

const app = new OpenAPIHono();

app.route("/invitations", invitationsRouter);
app.route("/rooms", roomsRouter);
app.route("/threads", threadsRouter);

export default app;
