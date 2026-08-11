import { getSession } from "@/lib/auth/auth.server";
import { chatRoomService } from "@/lib/services";

import { ChatJoinCard, ChatJoinInvalidCard } from "./components/chat-join-card";

export default async function ChatJoinPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const sessionPromise = getSession();
  const { token } = await params;

  let status: "valid" | "expired" | "revoked" | "depleted" | "not_found" =
    "not_found";
  let room: {
    id: string;
    name: string;
    organizationId: string;
    organizationName: string;
  } | null = null;

  try {
    const resolved = await chatRoomService.resolveRoomGuestInviteLink(token);
    status = resolved.status;
    room = resolved.room;
  } catch (error) {
    console.error("Failed to resolve chat room invite link", error);
  }

  const session = await sessionPromise;

  if (status !== "valid" || !room) {
    return <ChatJoinInvalidCard status={status} />;
  }

  return <ChatJoinCard token={token} room={room} user={session?.user} />;
}
