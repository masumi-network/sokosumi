import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetDeveloperTask from "./[id]/get.js";
import mountListDeveloperTasks from "./get.js";

const app = new OpenAPIHonoWithAuth();

mountListDeveloperTasks(app);
mountGetDeveloperTask(app);

export default app;
