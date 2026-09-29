import { OpenAPIHonoWithAuth } from "@/lib/hono";

import collectionsRouter from "./collections/index.js";
import filesRouter from "./files/index.js";
import foldersRouter from "./folders/index.js";
import labelsRouter from "./labels/index.js";
import recentsRouter from "./recents/index.js";
import resourcesRouter from "./resources/index.js";
import searchRouter from "./search/index.js";
import tablesRouter from "./tables/index.js";
import tasksRouter from "./tasks/index.js";

const app = new OpenAPIHonoWithAuth({
  includeWorkspaceContext: true,
  requireOrganizationProductSeat: true,
});

app.route("/collections", collectionsRouter);
app.route("/files", filesRouter);
app.route("/labels", labelsRouter);
app.route("/folders", foldersRouter);
app.route("/recents", recentsRouter);
app.route("/resources", resourcesRouter);
app.route("/search", searchRouter);
app.route("/tables", tablesRouter);
app.route("/tasks", tasksRouter);

export default app;
