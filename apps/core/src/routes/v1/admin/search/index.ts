import { createNestedOpenAPIHono } from "@/lib/hono";

import mountSearchAdminOrganizations from "./organizations/get.js";
import mountSearchAdminUsers from "./users/get.js";

const app = createNestedOpenAPIHono();

mountSearchAdminUsers(app);
mountSearchAdminOrganizations(app);

export default app;
