import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetEarlierChatThreads from "./earlier/get.js";
import mountGetUnreadChatThreads from "./unread/get.js";

const app = new OpenAPIHonoWithAuth();

mountGetUnreadChatThreads(app);
mountGetEarlierChatThreads(app);

export default app;
