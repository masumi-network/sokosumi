import { createNestedOpenAPIHono } from "@/lib/hono";

import mountGetDeveloperTask from "./[id]/get.js";
import mountListDeveloperTasks from "./get.js";

const app = createNestedOpenAPIHono();

mountListDeveloperTasks(app);
mountGetDeveloperTask(app);

export default app;
