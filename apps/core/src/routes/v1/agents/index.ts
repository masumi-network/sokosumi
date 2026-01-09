import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetAgentById from "./[id]/get.js";
import mountGetAgentInputSchema from "./[id]/input-schema/get.js";
import mountPostAgentJob from "./[id]/jobs/post.js";
import mountGetAgents from "./get.js";

const app = new OpenAPIHonoWithAuth();

mountGetAgents(app);
mountGetAgentById(app);
mountGetAgentInputSchema(app);
mountPostAgentJob(app);

export default app;
