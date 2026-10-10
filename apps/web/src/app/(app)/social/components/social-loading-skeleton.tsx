"use client";

import { useSearchParams } from "next/navigation";

import {
  SOCIAL_TABS,
  type SocialTab,
} from "@/app/projects/components/social-posts/constants";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Days of the week grid that carry placeholder posts, and how many. Fixed
 * rather than random so the skeleton does not shift between renders and reads
 * like a real week: a few busy days, a few empty ones.
 */
const PLACEHOLDER_POSTS_PER_DAY = [0, 2, 1, 0, 1, 0, 0];

function resolveSocialLoadingTab(value: string | null): SocialTab {
  return SOCIAL_TABS.find((tab) => tab === value) ?? "calendar";
}

export function SocialLoadingSkeleton({ label }: { label: string }) {
  const tab = resolveSocialLoadingTab(useSearchParams().get("tab"));

  return (
    <SocialLoadingChrome label={label} tab={tab}>
      {tab === "calendar" ? <CalendarPane /> : null}
      {tab === "drafts" || tab === "attention" ? <ListPane /> : null}
      {tab === "accounts" ? <AccountsPane /> : null}
      {tab === "statistics" ? <StatisticsPane /> : null}
    </SocialLoadingChrome>
  );
}

/** Tab row only, used while `useSearchParams` is still resolving. */
export function SocialLoadingFallback({ label }: { label: string }) {
  return <SocialLoadingChrome label={label} />;
}

function SocialLoadingChrome({
  children,
  label,
  tab,
}: {
  children?: React.ReactNode;
  label: string;
  tab?: SocialTab;
}) {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="space-y-8"
      data-loading-tab={tab}
      data-testid="social-loading"
      role="status"
    >
      <span className="sr-only">{label}</span>
      <section aria-hidden className="space-y-2">
        {/* The tab row and New post share one row, as on the page; on a
            phone New post is only its icon. */}
        <div className="flex items-center gap-3">
          <Skeleton className="h-11 w-64 min-w-0 sm:w-72" />
          <Skeleton className="h-11 w-14 shrink-0 sm:h-10 sm:w-32" />
        </div>
        {children}
      </section>
    </div>
  );
}

function CalendarPane() {
  return (
    <>
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
    </>
  );
}

function ListPane() {
  return (
    <ul className="grid gap-2 pt-2">
      {Array.from({ length: 4 }, (_, row) => (
        <li
          key={row}
          className="border-border flex flex-col gap-2 rounded-lg border p-3"
        >
          <div className="flex items-center gap-2">
            <Skeleton className="size-8 shrink-0 rounded-full" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="ms-auto h-4 w-16" />
          </div>
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </li>
      ))}
    </ul>
  );
}

function AccountsPane() {
  return (
    <ul className="divide-y rounded-lg border pt-2">
      {Array.from({ length: 3 }, (_, row) => (
        <li key={row} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-8 w-20" />
        </li>
      ))}
    </ul>
  );
}

function StatisticsPane() {
  return (
    <div className="space-y-6 pt-2">
      <div className="space-y-2">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, card) => (
          <div
            key={card}
            className="border-border space-y-3 rounded-lg border p-4"
          >
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-8 w-16" />
            <Skeleton className="h-3 w-full" />
          </div>
        ))}
      </div>
    </div>
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
