import { PROJECTS_WORKSPACE_SHELL_CLASS } from "@/app/projects/constants";
import { cn } from "@/lib/utils";

/**
 * Ads as a destination of its own.
 *
 * The same surface Social draws, with no visible headline: the breadcrumb and
 * the project switcher already name the page and the project. The `h1` is
 * `sr-only` so the heading outline still starts at the page, and it reads the
 * same string as the route's metadata.
 */
export function AdsPageShell({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <div className={cn(PROJECTS_WORKSPACE_SHELL_CLASS, "min-w-0 pt-2 md:pt-3")}>
      <h1 className="sr-only">{title}</h1>
      {children}
    </div>
  );
}
