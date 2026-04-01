import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountArchiveConversation from "./[id]/archive.js";
import mountGetConversation from "./[id]/get.js";
import mountGetConversationItems from "./[id]/items/get.js";
import mountPostConversationItem from "./[id]/items/post.js";
import mountPatchConversation from "./[id]/patch.js";
import mountPostRecoverResponse from "./[id]/recover-response/post.js";
import mountChat from "./chat/post.js";
import mountGetConversations from "./get.js";
import mountNewChat from "./new-chat/post.js";
import mountPostConversation from "./post.js";

const app = new OpenAPIHonoWithAuth();

mountGetConversations(app);
mountPostConversation(app);
mountGetConversation(app);
mountPatchConversation(app);
mountArchiveConversation(app);
mountGetConversationItems(app);
mountPostConversationItem(app);
mountPostRecoverResponse(app);
mountChat(app);
mountNewChat(app);

export default app;
