import {
  HOME_BOARD_CLASS,
  HOME_BOARD_COLUMN_CLASS,
  HOME_STACK_CLASS,
} from "@/app/(welcome)/components/home-layout";
import { WorkspaceColumnPanelSkeleton } from "@/app/projects/components/workspace-column-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Sync Instant Nav shell for `/chat` (no cookies/`connection()`/i18n).
 *
 * Both breakpoints land on the welcome here, so both get welcome bones —
 * mobile at the compact scale (32px mark, 80px featured face flanked by four
 * at 44px), desktop the centred column.
 *
 * Home's board follows the welcome: Needs you over Projects, the team's day
 * wider beside them from `xl`, as on the page.
 */
export function ChatHomePageSkeleton(): React.ReactElement {
  return (
    <div className={HOME_STACK_CLASS}>
      <div
        className="flex w-full flex-col items-center px-4 pt-4 md:hidden"
        data-testid="chat-home-loading-mobile"
      >
        <Skeleton className="size-8 shrink-0 rounded-full" />
        <div className="flex w-full flex-col items-center gap-3 py-6">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-72" />
          <div className="mt-5 flex items-center justify-center gap-3">
            <Skeleton className="size-11 rounded-full" />
            <Skeleton className="size-11 rounded-full" />
            <Skeleton className="size-20 rounded-full" />
            <Skeleton className="size-11 rounded-full" />
            <Skeleton className="size-11 rounded-full" />
          </div>
          <Skeleton className="mt-1 h-6 w-24" />
          <Skeleton className="h-4 w-64" />
          <Skeleton className="mt-3 h-12 w-full max-w-xs rounded-md" />
        </div>
      </div>

      <div
        className="hidden w-full items-center justify-center px-6 pt-10 md:flex"
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

      <div data-testid="home-board-loading" className={HOME_BOARD_CLASS}>
        <div className={HOME_BOARD_COLUMN_CLASS}>
          <WorkspaceColumnPanelSkeleton testId="home-needs-you-loading" />
          <WorkspaceColumnPanelSkeleton testId="home-projects-loading" />
        </div>
        <WorkspaceColumnPanelSkeleton testId="home-team-day-loading" />
      </div>
    </div>
  );
}
