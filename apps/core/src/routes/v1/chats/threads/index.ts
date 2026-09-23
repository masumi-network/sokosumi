import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetUnreadChatThreads from "./unread/get.js";

const app = new OpenAPIHonoWithAuth();

mountGetUnreadChatThreads(app);

export default app;
