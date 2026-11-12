import { createNestedOpenAPIHono } from "@/lib/hono";

import mountDelete from "./[id]/delete.js";
import mountPatch from "./[id]/patch.js";
import mountContent from "./content.js";
import mountFinalize from "./finalize.js";
import mountGet from "./get.js";
import mountGoogleSheets from "./google-sheets.js";
import mountMove from "./move.js";
import mountPost from "./post.js";

const app = createNestedOpenAPIHono();

mountPost(app);
mountFinalize(app);
mountGoogleSheets(app);
mountGet(app);
mountContent(app);
mountMove(app);
mountPatch(app);
mountDelete(app);

export default app;
