import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountDeleteConversation from "./[id]/delete.js";
import mountGetConversation from "./[id]/get.js";
import mountGetConversationItems from "./[id]/items/get.js";
import mountPostConversationItem from "./[id]/items/post.js";
import mountPatchConversation from "./[id]/patch.js";
import mountGetConversations from "./get.js";
import mountPostConversation from "./post.js";

const app = new OpenAPIHonoWithAuth();

mountGetConversations(app);
mountPostConversation(app);
mountGetConversation(app);
mountPatchConversation(app);
mountDeleteConversation(app);
mountGetConversationItems(app);
mountPostConversationItem(app);

export default app;
