import type { ReactNode } from "react";

/**
 * The Tasks toolbar's one row: the view switcher, active filter chips, then
 * search and the menus, which wrap together under them on a narrow page. The
 * board and its loading skeleton both use it, so they wrap at the same widths.
 */
export function TasksToolbarRow({ children }: { children: ReactNode }) {
  return (
    <div
      data-tasks-toolbar-row
      className="@container/page-toolbar flex min-w-0 flex-1 flex-wrap items-center gap-2"
    >
      {children}
    </div>
  );
}
