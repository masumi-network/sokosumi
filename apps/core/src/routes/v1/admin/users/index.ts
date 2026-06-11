import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountSearchAdminUsers from "./get.js";

const app = new OpenAPIHonoWithAuth();

mountSearchAdminUsers(app);

export default app;
