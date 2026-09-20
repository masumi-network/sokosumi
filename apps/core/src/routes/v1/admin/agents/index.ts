import { createNestedOpenAPIHono } from "@/lib/hono";

import mountGetAdminAgent from "./[id]/get.js";
import mountDeleteAdminAgentMetadataOverride from "./[id]/metadata-override/delete.js";
import mountPatchAdminAgentMetadataOverride from "./[id]/metadata-override/patch.js";
import mountGetAdminAgents from "./get.js";

const app = createNestedOpenAPIHono();

mountGetAdminAgents(app);
mountGetAdminAgent(app);
mountPatchAdminAgentMetadataOverride(app);
mountDeleteAdminAgentMetadataOverride(app);

export default app;
