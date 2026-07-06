import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountCreateAdminFreeCreditGrant from "./post.js";

const app = new OpenAPIHonoWithAuth();

mountCreateAdminFreeCreditGrant(app);

export default app;
