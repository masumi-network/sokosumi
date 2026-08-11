import { ChatChatsPageSkeleton } from "@/app/chat/components/chat-chats-loading-view";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Sync Instant Nav shell for `/chat` (no cookies/`connection()`/i18n).
 *
 * Mobile gets the chats-list bones because bare `/chat` redirects there;
 * desktop gets the landing's centred column.
 */
export function ChatHomePageSkeleton(): React.ReactElement {
  return (
    <>
      <ChatChatsPageSkeleton />
      <div
        className="hidden min-h-full w-full items-center justify-center px-6 py-10 md:flex"
        data-testid="chat-home-loading-desktop"
      >
        <div className="flex w-full max-w-xl flex-col items-center gap-10">
          <div className="flex w-full flex-col items-center gap-3">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-5 w-full max-w-md" />
          </div>
          <div className="flex flex-col items-center gap-4">
            <Skeleton className="size-20 rounded-full" />
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-11 w-44 rounded-md" />
          </div>
        </div>
      </div>
    </>
  );
}
