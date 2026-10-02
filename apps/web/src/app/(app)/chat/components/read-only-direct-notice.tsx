import type { ChatRoom } from "@sokosumi/core-client";
import { formatParticipantNameList } from "@sokosumi/utils";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { chatMobileComposerSafeAreaPbClass } from "./chat-mobile-tab-registry";
import { getFormerMemberNames } from "./room-helpers";

/**
 * What a read-only Direct says in place of its composers: who left, by their
 * own names rather than the room's (a Group name is not who left), and that
 * the history stays readable. Null while the room takes messages.
 */
export function useReadOnlyDirectNotice(
  room: ChatRoom | null | undefined,
): string | null {
  const t = useTranslations("App.Channels");
  if (!room?.isReadOnly) {
    return null;
  }
  const names = getFormerMemberNames(room);
  // A deleted account leaves no profile to name.
  if (names.length === 0) {
    return t("readOnlyDirectNoticeUnnamed");
  }
  return t("readOnlyDirectNotice", {
    members: formatParticipantNameList(names),
    count: names.length,
  });
}

interface ReadOnlyDirectNoticeProps {
  /** From `useReadOnlyDirectNotice`. */
  message: string;
}

/**
 * Stands in for the composer on a read-only Direct. Every other participant
 * has left, so nobody would read a new message; the history stays readable.
 */
export function ReadOnlyDirectNotice({ message }: ReadOnlyDirectNoticeProps) {
  return (
    <div
      className={cn(
        "shrink-0 px-4 md:px-5",
        chatMobileComposerSafeAreaPbClass(),
      )}
    >
      <p className="text-muted-foreground py-3 text-sm">{message}</p>
    </div>
  );
}
