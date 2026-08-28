import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetHistory from "./get.js";

const app = new OpenAPIHonoWithAuth({
  includeWorkspaceContext: true,
  requireOrganizationProductSeat: true,
});

mountGetHistory(app);

export default app;
