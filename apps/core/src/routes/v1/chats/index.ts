import { OpenAPIHonoWithAuth } from "@/lib/hono";

import roomsRouter from "./rooms/index.js";

const app = new OpenAPIHonoWithAuth();

app.route("/rooms", roomsRouter);

export default app;
