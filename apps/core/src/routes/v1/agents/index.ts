import { OpenAPIHonoWithAuth } from "@/lib/hono";

import { getAgentsHandler } from "./handlers";
import { getAgentsRoute } from "./routes";

const app = new OpenAPIHonoWithAuth();

app.openapi(getAgentsRoute, getAgentsHandler);

export default app;
