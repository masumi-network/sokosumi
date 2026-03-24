import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetOrganization from "./[id]/get.js";

const app = new OpenAPIHonoWithAuth();

mountGetOrganization(app);

export default app;
