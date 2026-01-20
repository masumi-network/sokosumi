import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountDeleteTaskComment from "./[id]/comments/[commentId]/delete.js";
import mountGetTaskCommentById from "./[id]/comments/[commentId]/get.js";
import mountPatchTaskComment from "./[id]/comments/[commentId]/patch.js";
import mountGetTaskComments from "./[id]/comments/get.js";
import mountPostTaskComment from "./[id]/comments/post.js";
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
mountGetTaskComments(app);
mountPostTaskComment(app);
mountGetTaskCommentById(app);
mountPatchTaskComment(app);
mountDeleteTaskComment(app);

export default app;
