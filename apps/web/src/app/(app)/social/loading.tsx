import { getTranslations } from "next-intl/server";

import { Skeleton } from "@/components/ui/skeleton";

import { SocialPageShell } from "./components/social-page-shell";

/**
 * Days of the week grid that carry placeholder posts, and how many. Fixed
 * rather than random so the skeleton does not shift between renders and reads
 * like a real week: a few busy days, a few empty ones.
 */
const PLACEHOLDER_POSTS_PER_DAY = [0, 2, 1, 0, 1, 0, 0];

/**
 * Social's shape while its calendar and accounts load: the section header with
 * New post, the calendar toolbar, a week of placeholder post cards, and the
 * accounts section. Drawn to the same boxes as the page so nothing jumps when
 * the content arrives.
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
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-72 max-w-full" />
            </div>
            <Skeleton className="h-9 w-32 shrink-0" />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <div className="flex items-center gap-2">
              <Skeleton className="size-9" />
              <Skeleton className="h-5 w-36" />
              <Skeleton className="size-9" />
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="h-9 w-56" />
              <Skeleton className="h-9 w-24" />
            </div>
          </div>

          <div className="border-border overflow-hidden rounded-xl border">
            <div className="grid grid-cols-7 border-b">
              {PLACEHOLDER_POSTS_PER_DAY.map((_, day) => (
                <div
                  key={day}
                  className="flex justify-center border-l py-2 first:border-l-0"
                >
                  <Skeleton className="h-4 w-12" />
                </div>
              ))}
            </div>
            <div className="grid min-h-60 grid-cols-7">
              {PLACEHOLDER_POSTS_PER_DAY.map((posts, day) => (
                <div
                  key={day}
                  className="flex min-w-0 flex-col gap-1.5 border-l p-1.5 first:border-l-0"
                >
                  {Array.from({ length: posts }, (_, post) => (
                    <PlaceholderPostCard key={post} />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section
          aria-hidden
          className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
        >
          <div className="space-y-2">
            <Skeleton className="h-5 w-36" />
            <Skeleton className="h-4 w-96 max-w-full" />
          </div>
          <Skeleton className="h-9 w-36 shrink-0" />
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
