import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetAdminOrganizationBySlug from "./[slug]/get.js";
import mountSearchAdminOrganizations from "./get.js";

const app = new OpenAPIHonoWithAuth();

mountSearchAdminOrganizations(app);
mountGetAdminOrganizationBySlug(app);

export default app;
