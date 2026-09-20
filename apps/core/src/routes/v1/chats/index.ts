import { OpenAPIHono } from "@hono/zod-openapi";

import invitationsRouter from "./invitations/index.js";
import roomsRouter from "./rooms/index.js";

const app = new OpenAPIHono();

app.route("/invitations", invitationsRouter);
app.route("/rooms", roomsRouter);

export default app;
