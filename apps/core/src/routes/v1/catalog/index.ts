import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetCatalog from "./get.js";

const app = new OpenAPIHonoWithAuth({
  includeWorkspaceContext: true,
});

mountGetCatalog(app);

export default app;
