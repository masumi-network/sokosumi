import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountPutOrganizationLogo from "./[id]/logo/put.js";

const app = new OpenAPIHonoWithAuth();

mountPutOrganizationLogo(app);

export default app;
