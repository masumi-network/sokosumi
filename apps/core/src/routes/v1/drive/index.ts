import { OpenAPIHonoWithAuth } from "@/lib/hono";

import filesRouter from "./files/index.js";
import foldersRouter from "./folders/index.js";
import tasksRouter from "./tasks/index.js";

const app = new OpenAPIHonoWithAuth({
  includeWorkspaceContext: true,
  requireOrganizationProductSeat: true,
});

app.route("/files", filesRouter);
app.route("/folders", foldersRouter);
app.route("/tasks", tasksRouter);

export default app;
