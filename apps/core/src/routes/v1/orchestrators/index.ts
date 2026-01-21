import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetOrchestratorById from "./[id]/get.js";
import mountGetOrchestrators from "./get.js";

const app = new OpenAPIHonoWithAuth();

mountGetOrchestrators(app);
mountGetOrchestratorById(app);

export default app;
