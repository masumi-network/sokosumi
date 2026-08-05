import { OpenAPIHonoWithAuth } from "@/lib/hono";

import invitationsRouter from "./invitations/index.js";
import roomsRouter from "./rooms/index.js";

const app = new OpenAPIHonoWithAuth();

app.route("/invitations", invitationsRouter);
app.route("/rooms", roomsRouter);

export default app;
