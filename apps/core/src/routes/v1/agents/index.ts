import { OpenAPIHonoWithAuth } from "@/lib/hono";

import getAgentsEndpoint from "./get";

const app = new OpenAPIHonoWithAuth();

app.openapi(getAgentsEndpoint.route, getAgentsEndpoint.handler);

export default app;
