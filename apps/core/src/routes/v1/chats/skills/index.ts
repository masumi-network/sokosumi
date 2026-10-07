import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountSearchChatSkills from "./get.js";

const app = new OpenAPIHonoWithAuth();

mountSearchChatSkills(app);

export default app;
