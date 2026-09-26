import { createNestedOpenAPIHono } from "@/lib/hono";

import mountGetAdminTask from "./[id]/get.js";
import mountListAdminTasks from "./get.js";

const app = createNestedOpenAPIHono();

mountListAdminTasks(app);
mountGetAdminTask(app);

export default app;
