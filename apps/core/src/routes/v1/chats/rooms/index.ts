import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountPostArchiveChatRoom from "./[id]/archive/post.js";
import mountDeleteChatRoom from "./[id]/delete.js";
import mountPostChatRoomFile from "./[id]/files/post.js";
import mountGetChatRoom from "./[id]/get.js";
import mountDeleteChatRoomInvitation from "./[id]/invitations/[invitationId]/delete.js";
import mountGetChatRoomInvitations from "./[id]/invitations/get.js";
import mountPostChatRoomInvitation from "./[id]/invitations/post.js";
import mountDeleteChatRoomGuestInviteLink from "./[id]/invite-links/[token]/delete.js";
import mountGetChatRoomGuestInviteLinks from "./[id]/invite-links/get.js";
import mountPostChatRoomGuestInviteLink from "./[id]/invite-links/post.js";
import mountDeleteChatRoomMember from "./[id]/members/[userId]/delete.js";
import mountDeleteChatRoomSelfMembership from "./[id]/members/me/delete.js";
import mountPostChatRoomSelfMembership from "./[id]/members/me/post.js";
import mountDeleteChatRoomMessage from "./[id]/messages/[messageId]/delete.js";
import mountPatchChatRoomMessage from "./[id]/messages/[messageId]/patch.js";
import mountPostChatRoomMessageReaction from "./[id]/messages/[messageId]/reactions/post.js";
import mountGetChatRoomMessages from "./[id]/messages/get.js";
import mountPostChatRoomMessage from "./[id]/messages/post.js";
import mountDeleteChatRoomMute from "./[id]/mute/delete.js";
import mountPostChatRoomMute from "./[id]/mute/post.js";
import mountPatchChatRoom from "./[id]/patch.js";
import mountDeleteChatRoomPin from "./[id]/pin/delete.js";
import mountPostChatRoomPin from "./[id]/pin/post.js";
import mountPostChatRoomRead from "./[id]/read/post.js";
import mountPostRestoreChatRoom from "./[id]/restore/post.js";
import mountRoomStream from "./[id]/stream/index.js";
import mountGetChatRoomThread from "./[id]/threads/[parentMessageId]/get.js";
import mountGetChatRoomThreadMessages from "./[id]/threads/[parentMessageId]/messages/get.js";
import mountPostChatRoomThreadRead from "./[id]/threads/[parentMessageId]/read/post.js";
import mountGetChatRoomThreads from "./[id]/threads/get.js";
import mountPostChatRoomThreadsRead from "./[id]/threads/read/post.js";
import mountGetChatRoomThreadsUnreadCount from "./[id]/threads/unread-count/get.js";
import mountPostChatRoomUnread from "./[id]/unread/post.js";
import mountDiscoverableChatRooms from "./discoverable/get.js";
import mountGetChatRooms from "./get.js";
import mountPostChatRoom from "./post.js";

const app = new OpenAPIHonoWithAuth();

mountGetChatRooms(app);
mountPostChatRoom(app);
// Static `/discoverable` before `/{id}` so it is not captured as a room id.
mountDiscoverableChatRooms(app);
// Static `stream` segment under `/{id}` — mount before generic `/{id}` if needed.
mountRoomStream(app);
mountGetChatRoom(app);
mountPatchChatRoom(app);
mountPostArchiveChatRoom(app);
mountPostRestoreChatRoom(app);
mountDeleteChatRoom(app);
// Room invitations under `/{id}/invitations` (host create/list/revoke).
mountPostChatRoomInvitation(app);
mountGetChatRoomInvitations(app);
mountDeleteChatRoomInvitation(app);
// Shareable guest invite links under `/{id}/invite-links` (host create/list/revoke).
mountPostChatRoomGuestInviteLink(app);
mountGetChatRoomGuestInviteLinks(app);
mountDeleteChatRoomGuestInviteLink(app);
// Static `members/me` before `members/{userId}`.
mountPostChatRoomSelfMembership(app);
mountDeleteChatRoomSelfMembership(app);
mountDeleteChatRoomMember(app);
mountPostChatRoomRead(app);
mountPostChatRoomUnread(app);
// Static `/threads/unread-count` and `/threads/read` before
// `/threads/{parentMessageId}`.
mountGetChatRoomThreads(app);
mountGetChatRoomThreadsUnreadCount(app);
mountPostChatRoomThreadsRead(app);
mountGetChatRoomThread(app);
mountGetChatRoomThreadMessages(app);
mountPostChatRoomThreadRead(app);
mountPostChatRoomPin(app);
mountDeleteChatRoomPin(app);
mountPostChatRoomMute(app);
mountDeleteChatRoomMute(app);
mountGetChatRoomMessages(app);
mountPostChatRoomMessage(app);
mountDeleteChatRoomMessage(app);
mountPatchChatRoomMessage(app);
mountPostChatRoomMessageReaction(app);
mountPostChatRoomFile(app);

export default app;
