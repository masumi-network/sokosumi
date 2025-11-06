import { OpenAPIHonoWithAuth } from "../../../lib/hono";
import { getMeHandler, getUserHandler } from "./handlers";
import { getMeRoute, getUserRoute } from "./routes";

const app = new OpenAPIHonoWithAuth();

app.openapi(getMeRoute, getMeHandler);
app.openapi(getUserRoute, getUserHandler);

export default app;
