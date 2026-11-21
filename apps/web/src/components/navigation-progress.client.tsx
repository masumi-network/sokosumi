"use client";

import { usePathname } from "next/navigation";
import { createContext, type ReactNode, Suspense, use } from "react";
import { usePendingNavigation } from "@/hooks/effects/use-pending-navigation";

const PendingPathnameContext = createContext<string | null>(null);

/**
 * The page a navigation in flight is heading for, or null when none is. A
 * search-param change heads for the page on screen.
 */
export function usePendingPathname(): string | null {
  return use(PendingPathnameContext);
}

/**
 * The page a nav row shows as current: the one a navigation in flight is
 * heading for, from the click on, and otherwise the page on screen.
 */
export function useNavPathname(): string {
  const pathname = usePathname();
  return use(PendingPathnameContext) ?? pathname;
}

/**
 * Hidden for the first 120ms, so a page that opens faster shows no bar. Then
 * it grows fast, slows, and waits at 90%. On arrival it fades out in 200ms
 * and only then, unseen, goes back to zero width. A navigation that starts
 * during that fade carries on from the width the bar has. Reduced motion
 * keeps the full width and only fades.
 */
const BAR_CLASS =
  "pointer-events-none fixed inset-x-0 top-[env(safe-area-inset-top)] z-50 h-[3px] origin-left scale-x-0 bg-primary opacity-0 [transition:opacity_200ms_ease-out,scale_0s_linear_200ms] data-[pending=true]:scale-x-90 data-[pending=true]:opacity-100 data-[pending=true]:[transition:opacity_40ms_linear_120ms,scale_4s_cubic-bezier(0.05,0.7,0.1,1)_120ms] motion-reduce:scale-x-100 motion-reduce:data-[pending=true]:scale-x-100 forced-colors:bg-[CanvasText]";

function NavigationProgressBar({ onScreen }: { onScreen: boolean }) {
  const pathname = usePathname();
  const pendingPathname = usePendingPathname();
  // The same page with other search params is a filter or a tab, not a page
  // load. Nor is a page a cache already paints.
  const isPending =
    pendingPathname !== null && pendingPathname !== pathname && !onScreen;

  return (
    <div
      aria-hidden="true"
      data-slot="navigation-progress"
      data-pending={isPending}
      className={BAR_CLASS}
    />
  );
}

/**
 * Shows on every page that a click was taken while the next page loads: the
 * bar along the top of the page, and the destination for the nav rows through
 * `useNavPathname`.
 */
export function NavigationProgress({ children }: { children: ReactNode }) {
  // Set inside the navigation's transition, so React drops it on arrival. A
  // hard navigation the reader cancels at a "Leave site?" prompt never
  // arrives: the bar and the row mark then stay until the next navigation
  // does.
  const pending = usePendingNavigation();

  return (
    <PendingPathnameContext value={pending?.pathname ?? null}>
      {children}
      {/* Decoration: Next's route announcer tells a screen reader. After the
          children, so at the overlay layer it paints over a sticky header.
          `usePathname` can suspend in a prerender, so the bar reads it behind
          its own boundary. */}
      <Suspense fallback={null}>
        <NavigationProgressBar onScreen={pending?.onScreen === true} />
      </Suspense>
    </PendingPathnameContext>
  );
}
