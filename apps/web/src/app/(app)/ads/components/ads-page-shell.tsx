import { PROJECTS_WORKSPACE_SHELL_CLASS } from "@/app/projects/constants";
import { cn } from "@/lib/utils";

/**
 * Ads as a destination of its own: the same surface Social and the studio
 * draw, with a visible title because the page has no other place to name its
 * project. The title is the string the route's metadata uses, so the tab and
 * the heading cannot disagree.
 */
export function AdsPageShell({
  children,
  projectName,
  title,
}: {
  children: React.ReactNode;
  /** Absent while the project is still loading. */
  projectName?: string;
  title: string;
}) {
  return (
    <div
      className={cn(
        PROJECTS_WORKSPACE_SHELL_CLASS,
        "flex min-w-0 flex-col gap-6 pt-2 md:pt-3",
      )}
    >
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {projectName ? (
          <p className="text-muted-foreground text-sm">{projectName}</p>
        ) : null}
      </header>
      {children}
    </div>
  );
}
