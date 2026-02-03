import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetOrchestratorById from "./[id]/get.js";
import mountPostOrchestratorUsage from "./[id]/usage/post.js";
import mountGetOrchestrators from "./get.js";

const app = new OpenAPIHonoWithAuth();

mountGetOrchestrators(app);
mountGetOrchestratorById(app);
mountPostOrchestratorUsage(app);

export default app;
