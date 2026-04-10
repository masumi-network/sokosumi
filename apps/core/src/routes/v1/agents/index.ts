import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetAgentById from "./[id]/get.js";
import mountGetAgentInputSchema from "./[id]/input-schema/get.js";
import mountGetJobsByAgentId from "./[id]/jobs/get.js";
import mountPostAgentJob from "./[id]/jobs/post.js";
import mountGetAgents from "./get.js";

const app = new OpenAPIHonoWithAuth({
  includeWorkspaceContext: true,
});

mountGetAgents(app);
mountGetAgentById(app);
mountGetAgentInputSchema(app);
mountGetJobsByAgentId(app);
mountPostAgentJob(app);

export default app;
