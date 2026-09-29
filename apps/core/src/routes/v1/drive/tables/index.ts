import { bodyLimit } from "hono/body-limit";
import { unprocessableEntity } from "@/helpers/error";
import { createNestedOpenAPIHono } from "@/lib/hono";
import mountBatch from "./batch.js";
import mountDetail from "./detail.js";
import mountEnrich from "./enrich.js";
import mountGet from "./get.js";
import mountHistory from "./history.js";
import mountPatch from "./patch.js";
import mountPost from "./post.js";
import mountQuery from "./query.js";
import mountUndo from "./undo.js";
import mountViews from "./views.js";

// The parent Drive router already applies authentication, coworker and
// organization context, workspace resolution and the seat check with these
// same options, as it does for the files, folders, recents and tasks
// sub-routers. Re-registering them here repeated that work on every table
// request. The 1 MB body limit stays: it is specific to table payloads.
const app = createNestedOpenAPIHono();
app.use(
  "*",
  bodyLimit({
    maxSize: 1_000_000,
    onError: () => {
      throw unprocessableEntity("Table requests are limited to 1 MB");
    },
  }),
);
mountPost(app);
mountGet(app);
mountDetail(app);
mountPatch(app);
mountQuery(app);
mountBatch(app);
mountViews(app);
mountUndo(app);
mountHistory(app);
mountEnrich(app);
export default app;
