import { createNestedOpenAPIHono } from "@/lib/hono";

import mountDeleteAdminBadgeCampaign from "./[id]/delete.js";
import mountEndAdminBadgeCampaign from "./[id]/end/post.js";
import mountPatchAdminBadgeCampaign from "./[id]/patch.js";
import mountListAdminBadgeCampaigns from "./get.js";
import mountCreateAdminBadgeCampaign from "./post.js";

const app = createNestedOpenAPIHono();

mountListAdminBadgeCampaigns(app);
mountCreateAdminBadgeCampaign(app);
mountPatchAdminBadgeCampaign(app);
mountDeleteAdminBadgeCampaign(app);
mountEndAdminBadgeCampaign(app);

export default app;
