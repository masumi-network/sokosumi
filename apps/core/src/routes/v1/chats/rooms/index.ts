import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetChatRoom from "./[id]/get.js";
import mountPostChatRoomMessageReaction from "./[id]/messages/[messageId]/reactions/post.js";
import mountGetChatRoomMessages from "./[id]/messages/get.js";
import mountPostChatRoomMessage from "./[id]/messages/post.js";
import mountPatchChatRoom from "./[id]/patch.js";
import mountPostChatRoomRead from "./[id]/read/post.js";
import mountRoomStream from "./[id]/stream/index.js";
import mountGetChatRooms from "./get.js";
import mountPostChatRoom from "./post.js";

const app = new OpenAPIHonoWithAuth();

mountGetChatRooms(app);
mountPostChatRoom(app);
// Static `stream` segment under `/{id}` — mount before generic `/{id}` if needed.
mountRoomStream(app);
mountGetChatRoom(app);
mountPatchChatRoom(app);
mountPostChatRoomRead(app);
mountGetChatRoomMessages(app);
mountPostChatRoomMessage(app);
mountPostChatRoomMessageReaction(app);

export default app;
