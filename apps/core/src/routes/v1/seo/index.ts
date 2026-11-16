import { OpenAPIHonoWithAuth } from "@/lib/hono";
import audits from "./audits";
import { mountSeoConnectionRoutes } from "./connections";

const app = new OpenAPIHonoWithAuth({ includeWorkspaceContext: true });
app.route("/audits", audits);
mountSeoConnectionRoutes(app);
export default app;
