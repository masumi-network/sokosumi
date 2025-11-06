import { OpenAPIHonoWithAuth } from "@/lib/hono";

import getUserEndpoint from "./[id]/get";
import getCurrentUserEndpoint from "./me/get";

const app = new OpenAPIHonoWithAuth();

app.openapi(getCurrentUserEndpoint.route, getCurrentUserEndpoint.handler);
app.openapi(getUserEndpoint.route, getUserEndpoint.handler);

export default app;
