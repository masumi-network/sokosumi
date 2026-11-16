import { redirect } from "next/navigation";
import { chatRoomHref } from "@/app/chat/utils/chat-route-base";
import { getSession } from "@/lib/auth/auth.server";
import { chatRoomService } from "@/lib/services/chat-room.service";
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

  // Core returns a room only to its members, so a hit means the reader is
  // already in it (the host, or a guest who joined before): open it rather
  // than offer a guest join that Core would refuse.
  const alreadyIn = await chatRoomService.getRoom(room.id).catch(() => null);
  if (alreadyIn) {
    redirect(chatRoomHref(room.id));
  }

  return <ChatJoinCard token={token} room={room} user={session?.user} />;
}
