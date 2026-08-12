import { Skeleton } from "@/components/ui/skeleton";

/**
 * Sync shell for `/onboarding` — no cookies, `connection()`, or i18n, so it can
 * paint during navigation and while the loader streams.
 *
 * Shaped like the welcome step (mark, headline, one line of copy, a row of
 * faces, primary action) so the real content lands in roughly the same place.
 * Used by both `loading.tsx` and the page's inner Suspense boundary; the
 * fallback there used to be an empty div, which is what made the first screen
 * after signup look like the product had stalled.
 */
export function OnboardingStepSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-6 py-6 sm:px-10">
        <Skeleton className="size-8 shrink-0 rounded-full" />

        <div className="my-auto flex w-full max-w-2xl flex-col items-center gap-4">
          <Skeleton className="h-9 w-72 max-w-full" />
          <Skeleton className="h-5 w-96 max-w-full" />

          <div className="mt-5 flex items-center justify-center gap-4">
            <Skeleton className="size-16 rounded-full" />
            <Skeleton className="size-16 rounded-full" />
            <Skeleton className="size-16 rounded-full" />
          </div>
          <Skeleton className="mt-1 h-4 w-56 max-w-full" />
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-3 border-t px-6 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:px-8 sm:py-6 sm:pb-6">
        <div />
        <Skeleton className="h-11 w-32 rounded-md" />
      </div>
    </div>
  );
}
