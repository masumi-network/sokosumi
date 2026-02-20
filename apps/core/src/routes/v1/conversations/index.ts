import { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserActorMiddleware } from "@/middleware/auth";

import mountArchiveConversation from "./[id]/archive.js";
import mountGetConversation from "./[id]/get.js";
import mountGetConversationItems from "./[id]/items/get.js";
import mountPostConversationItem from "./[id]/items/post.js";
import mountPatchConversation from "./[id]/patch.js";
import mountChat from "./chat/post.js";
import mountGetConversations from "./get.js";
import mountPostConversation from "./post.js";

const app = new OpenAPIHonoWithAuth();
app.use("*", requireUserActorMiddleware);

mountGetConversations(app);
mountPostConversation(app);
mountGetConversation(app);
mountPatchConversation(app);
mountArchiveConversation(app);
mountGetConversationItems(app);
mountPostConversationItem(app);
mountChat(app);

export default app;
