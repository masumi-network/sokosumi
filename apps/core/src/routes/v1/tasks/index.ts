import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountDeleteTask from "./[id]/delete.js";
import mountGetTaskEvents from "./[id]/events/get.js";
import mountPostTaskEvents from "./[id]/events/post.js";
import mountGetTaskById from "./[id]/get.js";
import mountPatchTask from "./[id]/patch.js";
import mountGetTasks from "./get.js";
import mountPostTask from "./post.js";

const app = new OpenAPIHonoWithAuth();

mountGetTasks(app);
mountPostTask(app);
mountGetTaskById(app);
mountPatchTask(app);
mountDeleteTask(app);
mountGetTaskEvents(app);
mountPostTaskEvents(app);

export default app;
