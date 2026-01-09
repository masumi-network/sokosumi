import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetAgentById from "./[id]/get.js";
import mountGetAgentInputSchema from "./[id]/input-schema/get.js";
import mountGetJobsByAgentId from "./[id]/jobs/get.js";
import mountGetAgents from "./get.js";

const app = new OpenAPIHonoWithAuth();

mountGetAgents(app);
mountGetAgentById(app);
mountGetAgentInputSchema(app);
mountGetJobsByAgentId(app);

export default app;
