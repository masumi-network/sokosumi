import { Skeleton } from "@/components/ui/skeleton";

/**
 * Sync Instant Nav shell for `/chat/chats` (no cookies/`connection()`/i18n).
 * Matches mobile-only OrganizationChatList page wrapper.
 */
export function ChatChatsPageSkeleton(): React.ReactElement {
  return (
    <div
      data-testid="chat-chats-loading"
      className="md:hidden -m-4 min-h-0 flex-1 overflow-y-auto p-4"
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
