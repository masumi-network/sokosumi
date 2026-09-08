import { OpenAPIHonoWithAuth } from "@/lib/hono";
import mountDeleteNotification from "./[id]/delete.js";
import mountMarkNotificationRead from "./[id]/read/patch.js";
import mountClearNotifications from "./delete.js";
import mountGetNotifications from "./get.js";
import mountMarkAllRead from "./read-all/patch.js";
import mountGetUnreadCount from "./unread-count/get.js";

const app = new OpenAPIHonoWithAuth();

mountGetNotifications(app);
mountGetUnreadCount(app);
mountMarkNotificationRead(app);
mountMarkAllRead(app);
mountDeleteNotification(app);
mountClearNotifications(app);

export default app;
