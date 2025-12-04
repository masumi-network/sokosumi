import { OpenAPIHonoWithRequestId } from "@/lib/hono.js";

import mountGetAgentById from "./[id]/get.js";
import mountGetAgents from "./get.js";

const app = new OpenAPIHonoWithRequestId();

mountGetAgents(app);
mountGetAgentById(app);

export default app;
