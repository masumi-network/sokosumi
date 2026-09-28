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
 * draw: one surface, one border weight, one gutter, a rule under the identity
 * row. What it does *not* have is a tab strip, because the studio is no longer
 * one area of a project — it is a top-level page that happens to be scoped to
 * a project, the way Tasks and Calendar are.
 */
export function StudioPageShell({
  children,
  mark,
  subtitle,
  title,
}: {
  children: React.ReactNode;
  mark: React.ReactNode;
  /** Which project this gallery belongs to, or why there is none yet. */
  subtitle: string;
  title: string;
}) {
  return (
    <div className={PROJECTS_WORKSPACE_SHELL_CLASS}>
      <div className={PROJECTS_WORKSPACE_CARD_CLASS}>
        <div
          className={cn(
            PROJECTS_WORKSPACE_GUTTER_CLASS,
            "border-border flex items-center gap-3 border-b py-4 md:pt-5",
          )}
        >
          <span aria-hidden className="shrink-0">
            {mark}
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-lg leading-tight font-semibold tracking-tight">
              {title}
            </h1>
            <p className="text-muted-foreground mt-0.5 truncate text-xs">
              {subtitle}
            </p>
          </div>
        </div>

        <div className={cn(PROJECTS_WORKSPACE_GUTTER_CLASS, "min-w-0 py-5")}>
          {children}
        </div>
      </div>
    </div>
  );
}
