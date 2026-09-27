import {
  PROJECTS_WORKSPACE_CARD_CLASS,
  PROJECTS_WORKSPACE_GUTTER_CLASS,
  PROJECTS_WORKSPACE_SHELL_CLASS,
} from "@/app/projects/constants";
import { cn } from "@/lib/utils";

/**
 * The studio as a destination of its own.
 *
 * Deliberately the same card the project workspace and the projects index
 * draw: one surface, one border weight, one gutter. What it does *not* have is
 * a tab strip, because the studio is no longer one area of a project — it is a
 * top-level page that happens to be scoped to a project, the way Tasks and
 * Calendar are.
 *
 * It no longer has an identity row either. A mark, the product name and the
 * project name repeated what the sidebar row, the breadcrumb and the project
 * switcher already say, and they said it in the one band of the page the
 * composer wanted: the studio is a thing you type into, so it opens on the box
 * you type into. The page's name survives where a name is actually read — the
 * document title, set by the route's metadata.
 */
export function StudioPageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className={PROJECTS_WORKSPACE_SHELL_CLASS}>
      <div className={PROJECTS_WORKSPACE_CARD_CLASS}>
        <div
          className={cn(
            PROJECTS_WORKSPACE_GUTTER_CLASS,
            "min-w-0 py-5 md:pt-6",
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
