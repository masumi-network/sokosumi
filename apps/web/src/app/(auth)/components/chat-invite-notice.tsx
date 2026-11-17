import { Hash } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { chatRoomService } from "@/lib/services/chat-room.service";

// Only the exact path the proxy sends a signed-out guest link to. Anything
// else (other pages, extra segments, queries, other hosts) asks Core nothing.
const CHAT_JOIN_RETURN_URL = /^\/chat\/join\/([A-Za-z0-9_-]+)$/;

interface ChatInviteNoticeProps {
  returnUrl: string | string[] | undefined;
}

/**
 * Above Log in or Register, says which channel a signed-out guest link
 * invites the person to. It shows what `/chat/join` already shows anyone
 * holding the token: the channel and its organization, and only while the
 * link is live. A dead or unreadable link shows nothing; the join page
 * explains it after login.
 */
export default async function ChatInviteNotice({
  returnUrl,
}: ChatInviteNoticeProps) {
  const token =
    typeof returnUrl === "string"
      ? CHAT_JOIN_RETURN_URL.exec(returnUrl)?.[1]
      : undefined;
  if (!token) {
    return null;
  }
  const resolved = await chatRoomService
    .resolveRoomGuestInviteLink(token)
    .catch(() => null);
  if (resolved?.status !== "valid" || !resolved.room) {
    return null;
  }
  const t = await getTranslations("App.Channels.ChatJoin");

  return (
    <Alert role="note" data-testid="chat-invite-notice">
      <Hash aria-hidden />
      <AlertTitle className="line-clamp-none text-pretty">
        {t("invitedToJoin", {
          room: resolved.room.name,
          organization: resolved.room.organizationName,
        })}
      </AlertTitle>
      <AlertDescription>{t("guestNote")}</AlertDescription>
    </Alert>
  );
}
