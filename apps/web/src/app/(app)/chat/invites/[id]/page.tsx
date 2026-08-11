import { chatRoomService } from "@/lib/services";

import ChatRoomInvitationCard, {
  ChatRoomInvitationErrorCard,
} from "./components/chat-room-invitation-card";

export default async function ChatRoomInvitePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const invitation = await chatRoomService.getInvitation(id);

  if (!invitation) {
    return (
      <div className="container flex items-center justify-center px-8 py-12">
        <ChatRoomInvitationErrorCard errorCode="NOT_FOUND" />
      </div>
    );
  }

  if (invitation.status === "expired") {
    return (
      <div className="container flex items-center justify-center px-8 py-12">
        <ChatRoomInvitationErrorCard errorCode="EXPIRED" />
      </div>
    );
  }

  return (
    <div className="container flex items-center justify-center px-8 py-12">
      <ChatRoomInvitationCard invitation={invitation} />
    </div>
  );
}
