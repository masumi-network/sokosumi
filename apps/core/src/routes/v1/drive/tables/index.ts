import { bodyLimit } from "hono/body-limit";
import { unprocessableEntity } from "@/helpers/error";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
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

const app = new OpenAPIHonoWithAuth({
  includeWorkspaceContext: true,
  requireOrganizationProductSeat: true,
});
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
