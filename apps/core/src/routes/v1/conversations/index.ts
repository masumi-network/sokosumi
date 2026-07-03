import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountArchiveConversation from "./[id]/archive.js";
import mountGetConversation from "./[id]/get.js";
import mountGetConversationMessages from "./[id]/messages/get.js";
import mountPostConversationMessage from "./[id]/messages/post.js";
import mountPatchConversation from "./[id]/patch.js";
import mountGetConversationWarmup from "./[id]/warmup/get.js";
import mountGetConversations from "./get.js";
import mountPostConversation from "./post.js";

const app = new OpenAPIHonoWithAuth();

mountGetConversations(app);
mountPostConversation(app);
mountGetConversation(app);
mountGetConversationWarmup(app);
mountPatchConversation(app);
mountArchiveConversation(app);
mountGetConversationMessages(app);
mountPostConversationMessage(app);

export default app;
