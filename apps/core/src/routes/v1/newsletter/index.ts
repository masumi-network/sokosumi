import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetAvailability from "./availability/get.js";

const app = new OpenAPIHonoWithAuth({ includeWorkspaceContext: true });

mountGetAvailability(app);

export default app;
