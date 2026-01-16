import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetBoard from "./board/get.js";
import mountDeleteOrchestrator from "./orchestrators/[id]/delete.js";
import mountGetOrchestratorById from "./orchestrators/[id]/get.js";
import mountPatchOrchestrator from "./orchestrators/[id]/patch.js";
import mountGetOrchestrators from "./orchestrators/get.js";
import mountPostOrchestrator from "./orchestrators/post.js";
import mountPostTaskActions from "./tasks/[id]/actions/post.js";
import mountDeleteTask from "./tasks/[id]/delete.js";
import mountGetTaskById from "./tasks/[id]/get.js";
import mountPatchTask from "./tasks/[id]/patch.js";
import mountPostTask from "./tasks/post.js";

const app = new OpenAPIHonoWithAuth();

mountGetBoard(app);
mountGetOrchestrators(app);
mountPostOrchestrator(app);
mountGetOrchestratorById(app);
mountPatchOrchestrator(app);
mountDeleteOrchestrator(app);
mountPostTask(app);
mountGetTaskById(app);
mountPatchTask(app);
mountDeleteTask(app);
mountPostTaskActions(app);

export default app;
