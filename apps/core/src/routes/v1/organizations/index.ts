import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetOrganization from "./[id]/get.js";
import mountPutOrganizationLogo from "./[id]/logo/put.js";

const app = new OpenAPIHonoWithAuth();

mountGetOrganization(app);
mountPutOrganizationLogo(app);

export default app;
