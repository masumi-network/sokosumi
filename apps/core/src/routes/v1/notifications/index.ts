import { OpenAPIHonoWithAuth } from "@/lib/hono";
import mountMarkNotificationRead from "./[id]/read/patch.js";
import mountGetNotifications from "./get.js";
import mountMarkAllRead from "./read-all/patch.js";
import mountGetUnreadCount from "./unread-count/get.js";

const app = new OpenAPIHonoWithAuth();

mountGetNotifications(app);
mountGetUnreadCount(app);
mountMarkNotificationRead(app);
mountMarkAllRead(app);

export default app;
