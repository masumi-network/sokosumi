import { OpenAPIHonoWithAuth } from "@/lib/hono";
import mountAccess from "./access.js";
import mountGet from "./get.js";
import mountPatchProspect from "./prospects/patch.js";

const app = new OpenAPIHonoWithAuth({
  includeWorkspaceContext: true,
  requireOrganizationProductSeat: true,
});

mountAccess(app);
mountGet(app);
mountPatchProspect(app);

export default app;
