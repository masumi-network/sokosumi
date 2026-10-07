import { LIST_MOBILE_CREATE_FAB_CLEARANCE } from "@/app/components/mobile-create-fab-geometry";
import { PROJECTS_WORKSPACE_SHELL_CLASS } from "@/app/projects/constants";
import { cn } from "@/lib/utils";

/**
 * Social as a destination of its own.
 *
 * The same surface the studio and the project workspace draw: one gutter, one
 * border weight. There is no tab strip and no identity row, because Social is
 * no longer one area of a project — it is a top-level page scoped to a
 * project, the way Tasks, Calendar and the studio are, and the sidebar row,
 * the breadcrumb and the project switcher already say which project it is.
 */
export function SocialPageShell({
  children,
  title,
}: {
  children: React.ReactNode;
  /**
   * The page's name, for the heading outline only — the same string the
   * route's metadata puts in the document title. It is `sr-only` because the
   * page carries no visible headline, and a page whose outline starts at `h2`
   * is a page a screen-reader reader cannot place.
   */
  title: string;
}) {
  return (
    <div
      className={cn(
        PROJECTS_WORKSPACE_SHELL_CLASS,
        "min-w-0 pt-2 md:pt-3",
        LIST_MOBILE_CREATE_FAB_CLEARANCE,
      )}
    >
      <h1 className="sr-only">{title}</h1>
      {children}
    </div>
  );
}
