import { createNestedOpenAPIHono } from "@/lib/hono";

import mountContent from "./[id]/content/get.js";
import mountGet from "./[id]/get.js";
import mountPatchMetadata from "./[id]/metadata/patch.js";
import mountReindex from "./[id]/reindex/post.js";
import mountRelated from "./[id]/related/get.js";
import mountSuggestionDecision from "./[id]/suggestions/decision-post.js";
import mountMetadataBatch from "./metadata-batch/post.js";
import mountSelectionToken from "./selection-token/post.js";

const app = createNestedOpenAPIHono();

// Fixed paths before the `{id}` routes, so `/selection-token` is never read
// as a resource id.
mountSelectionToken(app);
mountMetadataBatch(app);
mountGet(app);
mountContent(app);
mountRelated(app);
mountPatchMetadata(app);
mountSuggestionDecision(app);
mountReindex(app);

export default app;
