import { OpenAPIHonoWithAuth } from "@/lib/hono";
import properties from "./properties";
import sync from "./sync";

const app = new OpenAPIHonoWithAuth({ includeWorkspaceContext: true });
app.route("/", properties);
app.route("/", sync);
export default app;
