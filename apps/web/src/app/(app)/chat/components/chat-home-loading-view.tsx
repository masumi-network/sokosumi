import { ChatChatsPageSkeleton } from "@/app/chat/components/chat-chats-loading-view";
import { ONBOARDING_STEPS_MAX_WIDTH_CLASS } from "@/app/chat/onboarding/feature-width";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Sync Instant Nav shell for `/chat` (no cookies/`connection()`/i18n).
 * Desktop: questionnaire onboarding skeleton (intent step). Mobile:
 * chats-list skeleton (bare home redirects to `/chat/chats`).
 */
export function ChatHomePageSkeleton(): React.ReactElement {
  return (
    <>
      <ChatChatsPageSkeleton />
      <div
        data-testid="chat-home-loading-desktop"
        className={cn(
          "mx-auto hidden min-h-0 w-full flex-1 flex-col gap-6 px-4 py-6 md:flex md:py-10",
          ONBOARDING_STEPS_MAX_WIDTH_CLASS,
        )}
      >
        <div className="space-y-2">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-8 w-64 max-w-full" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>

        <Skeleton className="h-1.5 w-full rounded-full" />

        <div className="flex flex-col gap-3">
          <Skeleton className="h-20 w-full rounded-lg" />
          <Skeleton className="h-20 w-full rounded-lg" />
          <Skeleton className="h-20 w-full rounded-lg" />
        </div>

        <div className="mt-auto flex justify-end">
          <Skeleton className="h-10 w-20 rounded-md" />
        </div>
      </div>
    </>
  );
}
