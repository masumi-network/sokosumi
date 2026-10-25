import { OpenAPIHonoWithAuth } from "@/lib/hono";
import mountActivity from "./[id]/activity.js";
import mountArchive from "./[id]/archive.js";
import mountChannels from "./[id]/channels.js";
import mountGetContact from "./[id]/get.js";
import mountImportance from "./[id]/importance.js";
import mountInteractions from "./[id]/interactions.js";
import mountPatch from "./[id]/patch.js";
import mountExport from "./export.js";
import mountGet from "./get.js";
import mountImport from "./import.js";
import mountMerge from "./merge.js";
import mountOrganizations from "./organizations.js";
import mountPost from "./post.js";

const app = new OpenAPIHonoWithAuth({
  includeWorkspaceContext: true,
  requireOrganizationProductSeat: true,
});

// Static paths before `/{id}`.
mountGet(app);
mountPost(app);
mountExport(app);
mountMerge(app);
mountImport(app);
mountOrganizations(app);
mountGetContact(app);
mountPatch(app);
mountArchive(app);
mountChannels(app);
mountInteractions(app);
mountImportance(app);
mountActivity(app);

export default app;
