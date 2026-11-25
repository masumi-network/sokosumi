import { OpenAPIHonoWithAuth } from "@/lib/hono";
import mountAccess from "./access.js";
import mountFind from "./find.js";
import mountGet from "./get.js";
import mountDraft from "./prospects/draft.js";
import mountPatchProspect from "./prospects/patch.js";
import mountPaths from "./prospects/paths.js";
import mountSuggestions from "./suggestions.js";

const app = new OpenAPIHonoWithAuth({
  includeWorkspaceContext: true,
  requireOrganizationProductSeat: true,
});

mountAccess(app);
mountGet(app);
mountPatchProspect(app);
mountFind(app);
mountSuggestions(app);
mountPaths(app);
mountDraft(app);

export default app;
