import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetChatChannel from "./[id]/get.js";
import mountPostChatChannelMessageReaction from "./[id]/messages/[messageId]/reactions/post.js";
import mountGetChatChannelMessages from "./[id]/messages/get.js";
import mountPostChatChannelMessage from "./[id]/messages/post.js";
import mountPatchChatChannel from "./[id]/patch.js";
import mountPostChatChannelRead from "./[id]/read/post.js";
import mountPostDirectChatChannel from "./direct/post.js";
import mountGetChatChannels from "./get.js";
import mountPostChatChannel from "./post.js";

const app = new OpenAPIHonoWithAuth();

mountGetChatChannels(app);
mountPostChatChannel(app);
mountPostDirectChatChannel(app);
mountGetChatChannel(app);
mountPatchChatChannel(app);
mountPostChatChannelRead(app);
mountGetChatChannelMessages(app);
mountPostChatChannelMessage(app);
mountPostChatChannelMessageReaction(app);

export default app;
