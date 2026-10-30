import { OpenAPIHonoWithAuth } from "@/lib/hono";
import mountDelete from "./[id]/delete.js";
import mountImport from "./[id]/import.js";
import mountMembers from "./[id]/members.js";
import mountPatch from "./[id]/patch.js";
import mountGet from "./get.js";
import mountPost from "./post.js";

const app = new OpenAPIHonoWithAuth({
  includeWorkspaceContext: true,
  requireOrganizationProductSeat: true,
});

mountGet(app);
mountPost(app);
mountPatch(app);
mountDelete(app);
mountMembers(app);
mountImport(app);

export default app;
