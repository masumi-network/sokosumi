import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountListAdminUsers from "./get.js";

const app = new OpenAPIHonoWithAuth();

mountListAdminUsers(app);

export default app;
