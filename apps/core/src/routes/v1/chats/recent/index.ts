import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetRecentSokoBotChats from "./get.js";

const app = new OpenAPIHonoWithAuth();

mountGetRecentSokoBotChats(app);

export default app;
