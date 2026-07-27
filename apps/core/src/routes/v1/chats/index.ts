import { OpenAPIHonoWithAuth } from "@/lib/hono";

import conversationsRouter from "./conversations/index.js";
import roomsRouter from "./rooms/index.js";
import streamRouter from "./stream/index.js";

const app = new OpenAPIHonoWithAuth();

app.route("/rooms", roomsRouter);
app.route("/conversations", conversationsRouter);
app.route("/stream", streamRouter);

export default app;
