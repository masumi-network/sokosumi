import { PROJECTS_WORKSPACE_SHELL_CLASS } from "@/app/projects/constants";
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
 * you type into.
 */
export function StudioPageShell({
  children,
  title,
}: {
  children: React.ReactNode;
  /**
   * The page's name, for the heading outline only.
   *
   * The same string the route's metadata puts in the document title, and it is
   * `sr-only` on purpose: the visible headline row is gone, but a page whose
   * outline starts at `h2` is a page a screen-reader reader cannot place, and
   * everything below here — Templates, Images — is a section *of* something.
   * Hiding it visually is what lets the page open on the composer and still
   * have one `h1`.
   */
  title: string;
}) {
  return (
    // No card: like the task board, the page is the lighter surface and the
    // components sitting on it (composer, images) are the darker ones.
    <div className={cn(PROJECTS_WORKSPACE_SHELL_CLASS, "min-w-0 pt-2 md:pt-3")}>
      <h1 className="sr-only">{title}</h1>
      {children}
    </div>
  );
}
