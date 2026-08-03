import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountPostArchiveChatRoom from "./[id]/archive/post.js";
import mountPostChatRoomFile from "./[id]/files/post.js";
import mountGetChatRoom from "./[id]/get.js";
import mountDeleteChatRoomSelfMembership from "./[id]/members/me/delete.js";
import mountPostChatRoomSelfMembership from "./[id]/members/me/post.js";
import mountDeleteChatRoomMessage from "./[id]/messages/[messageId]/delete.js";
import mountPatchChatRoomMessage from "./[id]/messages/[messageId]/patch.js";
import mountPostChatRoomMessageReaction from "./[id]/messages/[messageId]/reactions/post.js";
import mountGetChatRoomMessages from "./[id]/messages/get.js";
import mountPostChatRoomMessage from "./[id]/messages/post.js";
import mountPatchChatRoom from "./[id]/patch.js";
import mountDeleteChatRoomPin from "./[id]/pin/delete.js";
import mountPostChatRoomPin from "./[id]/pin/post.js";
import mountPostChatRoomRead from "./[id]/read/post.js";
import mountPostRestoreChatRoom from "./[id]/restore/post.js";
import mountRoomStream from "./[id]/stream/index.js";
import mountPostChatRoomUnread from "./[id]/unread/post.js";
import mountBrowseChatRooms from "./browse/get.js";
import mountGetChatRooms from "./get.js";
import mountPostChatRoom from "./post.js";

const app = new OpenAPIHonoWithAuth();

mountGetChatRooms(app);
mountPostChatRoom(app);
// Static `/browse` before `/{id}` so "browse" is not captured as a room id.
mountBrowseChatRooms(app);
// Static `stream` segment under `/{id}` — mount before generic `/{id}` if needed.
mountRoomStream(app);
mountGetChatRoom(app);
mountPatchChatRoom(app);
mountPostArchiveChatRoom(app);
mountPostRestoreChatRoom(app);
mountPostChatRoomSelfMembership(app);
mountDeleteChatRoomSelfMembership(app);
mountPostChatRoomRead(app);
mountPostChatRoomUnread(app);
mountPostChatRoomPin(app);
mountDeleteChatRoomPin(app);
mountGetChatRoomMessages(app);
mountPostChatRoomMessage(app);
mountDeleteChatRoomMessage(app);
mountPatchChatRoomMessage(app);
mountPostChatRoomMessageReaction(app);
mountPostChatRoomFile(app);

export default app;
