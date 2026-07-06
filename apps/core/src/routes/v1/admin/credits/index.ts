import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountCreateAdminSupportCreditGrant from "./post.js";

const app = new OpenAPIHonoWithAuth();

mountCreateAdminSupportCreditGrant(app);

export default app;
