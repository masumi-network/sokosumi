import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetAdminTask from "./[id]/get.js";
import mountListAdminTasks from "./get.js";

const app = new OpenAPIHonoWithAuth();

mountListAdminTasks(app);
mountGetAdminTask(app);

export default app;
