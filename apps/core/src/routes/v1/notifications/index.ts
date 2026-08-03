import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountMarkNotificationRead from "./[id]/read/patch.js";
import mountGetNotifications from "./get.js";
import mountDeletePushSubscription from "./push-subscriptions/delete.js";
import mountUpsertPushSubscription from "./push-subscriptions/post.js";
import mountGetPushVapidPublicKey from "./push-vapid-public-key/get.js";
import mountMarkAllRead from "./read-all/patch.js";
import mountGetUnreadCount from "./unread-count/get.js";

const app = new OpenAPIHonoWithAuth();

// Static paths before dynamic `/{id}/…` routes
mountGetPushVapidPublicKey(app);
mountUpsertPushSubscription(app);
mountDeletePushSubscription(app);
mountGetNotifications(app);
mountGetUnreadCount(app);
mountMarkNotificationRead(app);
mountMarkAllRead(app);

export default app;
