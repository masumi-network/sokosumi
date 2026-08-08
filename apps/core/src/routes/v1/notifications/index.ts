import { OpenAPIHonoWithAuth } from "@/lib/hono";
import mountMarkNotificationRead from "./[id]/read/patch.js";
import mountUnregisterPushDevice from "./devices/delete.js";
import mountRegisterPushDevice from "./devices/post.js";
import mountGetNotifications from "./get.js";
import mountMarkAllRead from "./read-all/patch.js";
import mountGetUnreadCount from "./unread-count/get.js";

const app = new OpenAPIHonoWithAuth();

mountGetNotifications(app);
mountGetUnreadCount(app);
mountMarkNotificationRead(app);
mountMarkAllRead(app);
mountRegisterPushDevice(app);
mountUnregisterPushDevice(app);

export default app;
