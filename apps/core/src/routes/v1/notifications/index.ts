import { OpenAPIHonoWithAuth } from "@/lib/hono";
import mountMarkNotificationRead from "./[id]/read/patch.js";
import mountMarkNotificationUnread from "./[id]/unread/patch.js";
import mountGetNotifications from "./get.js";
import mountMarkNotificationsRead from "./read/patch.js";
import mountMarkAllRead from "./read-all/patch.js";
import mountMarkReadForReference from "./read-for-reference/patch.js";
import mountGetUnreadCount from "./unread-count/get.js";

const app = new OpenAPIHonoWithAuth();

mountGetNotifications(app);
mountGetUnreadCount(app);
mountMarkNotificationRead(app);
mountMarkNotificationUnread(app);
mountMarkAllRead(app);
mountMarkNotificationsRead(app);
mountMarkReadForReference(app);

export default app;
