import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountListAdminUsers from "./get.js";
import mountSearchAdminUsers from "./search/get.js";

const app = new OpenAPIHonoWithAuth();

mountListAdminUsers(app);
mountSearchAdminUsers(app);

export default app;
