import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetAgents from "./get";

const app = new OpenAPIHonoWithAuth();

mountGetAgents(app);

export default app;
