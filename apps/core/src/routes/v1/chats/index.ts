import { OpenAPIHono } from "@hono/zod-openapi";

import invitationsRouter from "./invitations/index.js";
import peopleRouter from "./people/index.js";
import roomsRouter from "./rooms/index.js";
import signalsRouter from "./signals/index.js";
import skillsRouter from "./skills/index.js";
import stickersRouter from "./stickers/index.js";
import threadsRouter from "./threads/index.js";

const app = new OpenAPIHono();

app.route("/invitations", invitationsRouter);
app.route("/people", peopleRouter);
app.route("/rooms", roomsRouter);
app.route("/signals", signalsRouter);
app.route("/skills", skillsRouter);
app.route("/stickers", stickersRouter);
app.route("/threads", threadsRouter);

export default app;
