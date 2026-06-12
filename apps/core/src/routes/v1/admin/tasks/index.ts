import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountListAdminTasks from "./get.js";

const app = new OpenAPIHonoWithAuth();

mountListAdminTasks(app);

export default app;
