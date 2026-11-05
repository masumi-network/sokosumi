import { OpenAPIHonoWithAuth } from "@/lib/hono";
import { createSeoStatisticsPropertiesRouter } from "./properties";
import { createSeoStatisticsSyncRouter } from "./sync";

export function createSeoStatisticsRouter(ownerKind: "project" | "audit") {
  const app = new OpenAPIHonoWithAuth({ includeWorkspaceContext: true });
  app.route("/", createSeoStatisticsPropertiesRouter(ownerKind));
  app.route("/", createSeoStatisticsSyncRouter(ownerKind));
  return app;
}
