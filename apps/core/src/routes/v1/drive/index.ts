import { OpenAPIHonoWithAuth } from "@/lib/hono";

import filesRouter from "./files/index.js";
import foldersRouter from "./folders/index.js";

const app = new OpenAPIHonoWithAuth();

app.route("/files", filesRouter);
app.route("/folders", foldersRouter);

export default app;
