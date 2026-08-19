import { OpenAPIHonoWithAuth } from "@/lib/hono";

import filesRouter from "./files/index.js";

const app = new OpenAPIHonoWithAuth();

app.route("/files", filesRouter);

export default app;
