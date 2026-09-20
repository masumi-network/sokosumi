import { createNestedOpenAPIHono } from "@/lib/hono";
import mountRemoveTaskScheduleQuarantine from "./[taskId]/remove/post.js";
import mountRepairTaskScheduleQuarantine from "./[taskId]/repair/post.js";

const app = createNestedOpenAPIHono();

mountRepairTaskScheduleQuarantine(app);
mountRemoveTaskScheduleQuarantine(app);

export default app;
