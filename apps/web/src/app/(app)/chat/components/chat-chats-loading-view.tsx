import { Skeleton } from "@/components/ui/skeleton";

/**
 * Sync Instant Nav shell for `/chat/chats` (no cookies/`connection()`/i18n).
 * Matches the non-beta mobile Chats page: the welcome, then OrganizationChatList.
 * Personal Assistant is beta-gated and omitted here so non-beta users do not
 * flash PA chrome that never mounts.
 *
 * The welcome block is reserved at roughly its real height so the room list
 * does not jump down when the page streams in behind this shell.
 */
export function ChatChatsPageSkeleton(): React.ReactElement {
  return (
    <div
      data-testid="chat-chats-loading"
      className="md:hidden -m-4 min-h-0 flex-1 overflow-y-auto"
    >
      <div className="flex flex-col items-center px-4 pt-4 pb-5">
        <Skeleton className="size-8 rounded-full" />
        <Skeleton className="mt-2.5 h-7 w-64" />
        <Skeleton className="mt-2 h-4 w-72" />
        <Skeleton className="mt-1.5 h-4 w-56" />
        <div className="mt-5 flex items-center justify-center gap-3">
          <Skeleton className="size-11 rounded-full" />
          <Skeleton className="size-11 rounded-full" />
          <Skeleton className="size-20 rounded-full" />
          <Skeleton className="size-11 rounded-full" />
          <Skeleton className="size-11 rounded-full" />
        </div>
        <Skeleton className="mt-3 h-6 w-24" />
        <Skeleton className="mt-1 h-4 w-64" />
        <Skeleton className="mt-4 h-12 w-full max-w-xs rounded-md" />
      </div>

      <div className="border-t p-4">
        <div className="mb-3 flex items-center justify-between">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-5 w-16" />
        </div>
        <ul className="flex flex-col gap-3">
          {Array.from({ length: 5 }, (_, index) => (
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
    </div>
  );
}
