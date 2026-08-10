import { ONBOARDING_STEPS_MAX_WIDTH_CLASS } from "@/app/chat/onboarding/feature-width";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface ChatOnboardingPageSkeletonProps {
  className?: string;
  "data-testid"?: string;
}

/**
 * Sync Instant Nav bones for questionnaire onboarding (intent step).
 * No cookies/`connection()`/i18n.
 */
export function ChatOnboardingPageSkeleton({
  className,
  "data-testid": testId = "chat-onboarding-loading",
}: ChatOnboardingPageSkeletonProps): React.ReactElement {
  return (
    <div
      data-testid={testId}
      className={cn(
        "mx-auto flex min-h-0 w-full flex-1 flex-col gap-6 px-4 py-6 md:py-10",
        ONBOARDING_STEPS_MAX_WIDTH_CLASS,
        className,
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
  );
}
