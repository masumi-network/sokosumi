import { OpenAPIHonoWithAuth } from "@/lib/hono";
import mountRemoveTaskScheduleQuarantine from "./[taskId]/remove/post.js";
import mountRepairTaskScheduleQuarantine from "./[taskId]/repair/post.js";

const app = new OpenAPIHonoWithAuth();

mountRepairTaskScheduleQuarantine(app);
mountRemoveTaskScheduleQuarantine(app);

export default app;
