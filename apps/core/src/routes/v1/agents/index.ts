import { OpenAPIHonoWithAuth } from "../../../lib/hono";
import mountGetAgentById from "./[id]/get.js";
import mountGetAgents from "./get.js";

const app = new OpenAPIHonoWithAuth();

mountGetAgents(app);
mountGetAgentById(app);

export default app;
