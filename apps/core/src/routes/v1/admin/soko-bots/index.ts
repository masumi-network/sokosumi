import { createNestedOpenAPIHono } from "@/lib/hono";
import mountPerformAdminSokoBotAction from "./[sokoBotId]/actions/post.js";
import mountDeleteAdminSokoBot from "./[sokoBotId]/delete.js";
import mountGetAdminSokoBot from "./[sokoBotId]/get.js";
import mountGetAdminSokoBotAvailability from "./availability/get.js";
import mountSetAdminSokoBotAvailability from "./availability/put.js";
import mountListAdminSokoBots from "./get.js";
import mountGetAdminSokoBotQuality from "./quality/get.js";
import mountArchiveAdminSokoBotVersion from "./versions/[slug]/delete.js";
import mountUpdateAdminSokoBotVersion from "./versions/[slug]/patch.js";
import mountPromoteAdminSokoBotVersion from "./versions/[slug]/promote/post.js";
import mountListAdminSokoBotVersions from "./versions/get.js";
import mountMigrateAdminSokoBotVersions from "./versions/migrate/post.js";
import mountListAdminSokoBotGatewayModels from "./versions/models/get.js";
import mountCreateAdminSokoBotVersion from "./versions/post.js";
import mountGetAdminSokoBotVersionUsage from "./versions/usage/get.js";

const app = createNestedOpenAPIHono();

mountListAdminSokoBots(app);
mountGetAdminSokoBotQuality(app);
mountListAdminSokoBotVersions(app);
mountListAdminSokoBotGatewayModels(app);
mountCreateAdminSokoBotVersion(app);
mountUpdateAdminSokoBotVersion(app);
mountGetAdminSokoBotAvailability(app);
mountSetAdminSokoBotAvailability(app);
mountDeleteAdminSokoBot(app);
mountArchiveAdminSokoBotVersion(app);
mountPromoteAdminSokoBotVersion(app);
mountGetAdminSokoBotVersionUsage(app);
mountMigrateAdminSokoBotVersions(app);
mountGetAdminSokoBot(app);
mountPerformAdminSokoBotAction(app);

export default app;
