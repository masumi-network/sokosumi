import { Skeleton } from "@/components/ui/skeleton";

/**
 * Sync Instant Nav shell for `/chat/chats` (no cookies/`connection()`/i18n).
 * Matches the non-beta mobile Chats page: OrganizationChatList only.
 * Personal Assistant is beta-gated and omitted here so non-beta users do not
 * flash PA chrome that never mounts.
 *
 * Grow with content so AppMobileChrome's in-flow tab-bar spacer clears the last
 * row (no nested overflow-y-auto height lock). No create-FAB clearance — that
 * FAB no longer mounts on this surface.
 */
export function ChatChatsPageSkeleton(): React.ReactElement {
  return (
    <div
      data-testid="chat-chats-loading"
      className="bg-background md:hidden -m-4 flex flex-1 flex-col p-4"
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
