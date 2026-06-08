import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetOrganization from "./[id]/get.js";
import mountGetOrganizationMembers from "./[id]/members/get.js";

const app = new OpenAPIHonoWithAuth();

mountGetOrganization(app);
mountGetOrganizationMembers(app);

export default app;
