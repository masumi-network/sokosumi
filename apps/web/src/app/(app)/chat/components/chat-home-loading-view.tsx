import { ChatChatsPageSkeleton } from "@/app/chat/components/chat-chats-loading-view";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Sync Instant Nav shell for `/chat` (no cookies/`connection()`/i18n).
 * Desktop: welcome skeleton. Mobile: chats-list skeleton (bare home redirects
 * to `/chat/chats`).
 */
export function ChatHomePageSkeleton(): React.ReactElement {
  return (
    <>
      <ChatChatsPageSkeleton />
      <div
        data-testid="chat-home-loading-desktop"
        className="mx-auto hidden w-full max-w-2xl flex-col items-center gap-6 px-4 py-12 md:flex"
      >
        <div className="flex w-full flex-col items-center gap-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-12 w-full max-w-xl rounded-xl" />
        <div className="flex flex-wrap justify-center gap-2">
          <Skeleton className="h-8 w-28 rounded-full" />
          <Skeleton className="h-8 w-24 rounded-full" />
          <Skeleton className="h-8 w-32 rounded-full" />
        </div>
      </div>
    </>
  );
}
