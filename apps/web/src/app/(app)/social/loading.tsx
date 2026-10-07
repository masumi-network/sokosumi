import { getTranslations } from "next-intl/server";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { SocialPageShell } from "./components/social-page-shell";

/**
 * Days of the week grid that carry placeholder posts, and how many. Fixed
 * rather than random so the skeleton does not shift between renders and reads
 * like a real week: a few busy days, a few empty ones.
 */
const PLACEHOLDER_POSTS_PER_DAY = [0, 2, 1, 0, 1, 0, 0];

/**
 * Social's shape while its calendar loads: the tab row with New post, the
 * calendar toolbar and a week of placeholder post cards. Drawn to the same
 * boxes as the page so nothing jumps when the content arrives.
 */
export default async function SocialLoading() {
  const t = await getTranslations("App.Social");

  return (
    <SocialPageShell title={t("title")}>
      <div
        aria-busy="true"
        aria-live="polite"
        className="space-y-8"
        data-testid="social-loading"
        role="status"
      >
        <span className="sr-only">{t("loading")}</span>

        <section aria-hidden className="space-y-2">
          {/* The tab row and New post share one row, as on the page; on a
              phone New post is only its icon. */}
          <div className="flex items-center justify-between gap-2">
            <Skeleton className="h-9 w-64 min-w-0 sm:w-72" />
            <Skeleton className="h-9 w-14 shrink-0 sm:w-32" />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 pt-2">
            <div className="flex items-center gap-2 max-sm:w-full">
              <Skeleton className="size-9 max-sm:hidden" />
              <Skeleton className="h-5 w-36 max-sm:me-auto" />
              <Skeleton className="size-9" />
              <Skeleton className="size-9 sm:hidden" />
            </div>
            <div className="flex items-center justify-between gap-2 max-sm:w-full">
              <Skeleton className="h-9 w-32 sm:w-56" />
              <Skeleton className="h-9 w-24" />
            </div>
          </div>

          <div className="border-border overflow-hidden rounded-xl border">
            {/* A phone shows about three days of the week at once, so the
                skeleton draws three rather than seven narrow columns. */}
            <div className="grid grid-cols-3 border-b sm:grid-cols-7">
              {PLACEHOLDER_POSTS_PER_DAY.map((_, day) => (
                <div
                  key={day}
                  className={cn(
                    "flex justify-center border-l py-2 first:border-l-0",
                    day >= 3 && "max-sm:hidden",
                  )}
                >
                  <Skeleton className="h-4 w-12" />
                </div>
              ))}
            </div>
            <div className="grid min-h-60 grid-cols-3 sm:grid-cols-7">
              {PLACEHOLDER_POSTS_PER_DAY.map((posts, day) => (
                <div
                  key={day}
                  className={cn(
                    "flex min-w-0 flex-col gap-1.5 border-l p-1.5 first:border-l-0",
                    day >= 3 && "max-sm:hidden",
                  )}
                >
                  {Array.from({ length: posts }, (_, post) => (
                    <PlaceholderPostCard key={post} />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </SocialPageShell>
  );
}

/** The calendar's post card, as blocks: account and time, a line of text, status. */
function PlaceholderPostCard() {
  return (
    <div className="border-border flex flex-col gap-1.5 rounded-md border p-1.5">
      <div className="flex items-center gap-1">
        <Skeleton className="size-4 shrink-0 rounded-full" />
        <Skeleton className="h-3 min-w-0 flex-1" />
        <Skeleton className="h-3 w-10 shrink-0" />
      </div>
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-2/3" />
      <div className="flex items-center gap-1">
        <Skeleton className="size-5 rounded-full" />
        <Skeleton className="size-5 rounded-full" />
      </div>
    </div>
  );
}
