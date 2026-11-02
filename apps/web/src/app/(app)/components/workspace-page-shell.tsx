import { PROJECTS_WORKSPACE_SHELL_CLASS } from "@/app/projects/constants";
import { cn } from "@/lib/utils";

/**
 * Top-level project-scoped destinations (Social, Ads, …) that open without a
 * visible page headline. The sidebar's active row and the project selector already name
 * the page; the `h1` is `sr-only` so the outline still starts at the page.
 */
export function WorkspacePageShell({
  children,
  className,
  title,
}: {
  children: React.ReactNode;
  className?: string;
  title: string;
}) {
  return (
    <div
      className={cn(
        PROJECTS_WORKSPACE_SHELL_CLASS,
        "min-w-0 pt-2 md:pt-3",
        className,
      )}
    >
      <h1 className="sr-only">{title}</h1>
      {children}
    </div>
  );
}
