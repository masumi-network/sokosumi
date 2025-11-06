import { OpenAPIHonoWithAuth } from "@/lib/hono";

import getUserEndpoint from "./[id]/get";
import getCurrentUserEndpoint from "./me/get";

const app = new OpenAPIHonoWithAuth();

app.routeEndpoints([getCurrentUserEndpoint, getUserEndpoint]);

export default app;
