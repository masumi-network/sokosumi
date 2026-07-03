import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountDeleteTask from "./[id]/delete.js";
import mountGetTaskEvents from "./[id]/events/get.js";
import mountPostTaskEvents from "./[id]/events/post.js";
import mountGetTaskById from "./[id]/get.js";
import mountGetTaskJobs from "./[id]/jobs/get.js";
import mountPostTaskJob from "./[id]/jobs/post.js";
import mountDeleteTaskLink from "./[id]/links/[linkId]/delete.js";
import mountPatchTaskLink from "./[id]/links/[linkId]/patch.js";
import mountGetTaskLinks from "./[id]/links/get.js";
import mountPostTaskLink from "./[id]/links/post.js";
import mountPatchTask from "./[id]/patch.js";
import mountDeleteTaskSchedule from "./[id]/schedule/delete.js";
import mountPutTaskSchedule from "./[id]/schedule/put.js";
import mountDeleteTaskShareById from "./[id]/share/delete.js";
import mountPutTaskShareById from "./[id]/share/put.js";
import mountGetTaskWorkspace from "./[id]/workspace/get.js";
import mountPutTaskWorkspace from "./[id]/workspace/put.js";
import mountGetTasks from "./get.js";
import mountPostTask from "./post.js";

const app = new OpenAPIHonoWithAuth({
  includeWorkspaceContext: true,
});

mountGetTasks(app);
mountPostTask(app);
mountGetTaskLinks(app);
mountPostTaskLink(app);
mountDeleteTaskLink(app);
mountPatchTaskLink(app);
mountGetTaskById(app);
mountPatchTask(app);
mountPutTaskSchedule(app);
mountDeleteTaskSchedule(app);
mountPutTaskShareById(app);
mountDeleteTaskShareById(app);
mountGetTaskWorkspace(app);
mountPutTaskWorkspace(app);
mountDeleteTask(app);
mountGetTaskEvents(app);
mountPostTaskEvents(app);
mountGetTaskJobs(app);
mountPostTaskJob(app);

export default app;
