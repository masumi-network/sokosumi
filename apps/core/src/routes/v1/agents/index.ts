import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetAgentById from "./[id]/get";
import mountGetAgents from "./get";

console.log("[module-load]", import.meta.url);

const app = new OpenAPIHonoWithAuth();

mountGetAgents(app);
mountGetAgentById(app);

export default app;
