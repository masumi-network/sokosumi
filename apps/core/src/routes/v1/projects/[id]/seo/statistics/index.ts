import { OpenAPIHonoWithAuth } from "@/lib/hono";
import { createSeoStatisticsPropertiesRouter } from "./properties";
import { createSeoStatisticsSyncRouter } from "./sync";
import { createSeoSiteTrafficRouter } from "./traffic";

export function createSeoStatisticsRouter(ownerKind: "project" | "audit") {
  const app = new OpenAPIHonoWithAuth({ includeWorkspaceContext: true });
  app.route("/", createSeoStatisticsPropertiesRouter(ownerKind));
  app.route("/", createSeoStatisticsSyncRouter(ownerKind));
  app.route("/", createSeoSiteTrafficRouter(ownerKind));
  return app;
}
