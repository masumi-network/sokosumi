import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountDeleteOrchestrator from "./[id]/delete.js";
import mountGetOrchestratorById from "./[id]/get.js";
import mountPatchOrchestrator from "./[id]/patch.js";
import mountGetOrchestrators from "./get.js";
import mountPostOrchestrator from "./post.js";

const app = new OpenAPIHonoWithAuth();

mountGetOrchestrators(app);
mountPostOrchestrator(app);
mountGetOrchestratorById(app);
mountPatchOrchestrator(app);
mountDeleteOrchestrator(app);

export default app;
