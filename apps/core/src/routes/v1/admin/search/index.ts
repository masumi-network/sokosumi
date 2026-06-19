import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountSearchAdminOrganizations from "./organizations/get.js";
import mountSearchAdminUsers from "./users/get.js";

const app = new OpenAPIHonoWithAuth();

mountSearchAdminUsers(app);
mountSearchAdminOrganizations(app);

export default app;
