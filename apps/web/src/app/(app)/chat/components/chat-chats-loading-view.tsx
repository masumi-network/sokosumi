import { CHAT_CHATS_MOBILE_LIST_SHELL_CLASS } from "@/app/chat/chats/chat-chats-list-shell";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Sync Instant Nav shell for `/chat` (no cookies/`connection()`/i18n).
 * Matches the non-beta mobile Chats page: OrganizationChatList only.
 * Personal Assistant is beta-gated and omitted here so non-beta users do not
 * flash PA chrome that never mounts.
 *
 * Same bottom-inset shell as the page (`CHAT_CHATS_MOBILE_LIST_SHELL_CLASS`).
 */
export function ChatChatsPageSkeleton(): React.ReactElement {
  return (
    <div
      data-testid="chat-chats-loading"
      className={cn(CHAT_CHATS_MOBILE_LIST_SHELL_CLASS, "px-4 pt-4")}
    >
      <div className="mb-3 flex items-center justify-between">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-5 w-16" />
      </div>
      <ul className="flex flex-col gap-3">
        {Array.from({ length: 7 }, (_, index) => (
          <li key={index} className="flex items-center gap-3">
            <Skeleton className="size-10 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-52" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
