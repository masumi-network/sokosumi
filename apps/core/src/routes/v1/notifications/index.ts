import { OpenAPIHonoWithAuth } from "@/lib/hono";
import mountMarkNotificationRead from "./[id]/read/patch.js";
import mountMarkNotificationUnread from "./[id]/unread/patch.js";
import mountGetCounts from "./counts/get.js";
import mountGetNotifications from "./get.js";
import mountMarkNotificationsRead from "./read/patch.js";
import mountMarkAllRead from "./read-all/patch.js";

const app = new OpenAPIHonoWithAuth();

mountGetNotifications(app);
mountGetCounts(app);
mountMarkNotificationRead(app);
mountMarkNotificationUnread(app);
mountMarkAllRead(app);
mountMarkNotificationsRead(app);

export default app;
