import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { chatMobileComposerSafeAreaPbClass } from "./chat-mobile-tab-registry";

interface ReadOnlyDirectNoticeProps {
  /** Who left, as the room is named: the Former members. */
  members: string;
}

/**
 * Stands in for the composer on a read-only Direct. Every other participant
 * has left, so nobody would read a new message; the history stays readable.
 */
export function ReadOnlyDirectNotice({ members }: ReadOnlyDirectNoticeProps) {
  const t = useTranslations("App.Channels");

  return (
    <div
      className={cn(
        "shrink-0 px-4 md:px-5",
        chatMobileComposerSafeAreaPbClass(),
      )}
    >
      <p className="text-muted-foreground py-3 text-sm">
        {t("readOnlyDirectNotice", { members })}
      </p>
    </div>
  );
}
