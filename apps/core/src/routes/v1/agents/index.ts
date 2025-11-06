import { OpenAPIHonoWithAuth } from "@/lib/hono";

import getAgentsEndpoint from "./get";

const app = new OpenAPIHonoWithAuth();

app.routeEndpoint(getAgentsEndpoint);

export default app;
