import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountSearchAdminUsers from "./get.js";
import mountListAdminUserOverview from "./overview/get.js";

const app = new OpenAPIHonoWithAuth();

mountSearchAdminUsers(app);
mountListAdminUserOverview(app);

export default app;
