import { WorkspacePageShell } from "@/app/components/workspace-page-shell";
import {
  type ProjectTab,
  ProjectTabs,
} from "@/app/projects/components/project-tabs";

/**
 * Newsletter as a destination of its own, in the same shell as Social.
 *
 * The heading names the project whose newsletter this is: the project comes
 * from `?projectId=`, and nothing else on the page would say which one it is.
 *
 * A single tab is not navigation (setup has only Settings), so the bar shows
 * once there is somewhere else to go.
 */
export function NewsletterPageShell({
  children,
  description,
  heading,
  navigationLabel,
  tabs,
  title,
}: {
  children: React.ReactNode;
  description: string;
  heading: string;
  navigationLabel?: string;
  tabs?: readonly ProjectTab[];
  /** The `sr-only` page title, as on Social. */
  title: string;
}) {
  return (
    <WorkspacePageShell title={title}>
      <div className="min-w-0 space-y-6">
        <header className="space-y-1">
          <h2 className="text-lg font-semibold">{heading}</h2>
          <p className="text-muted-foreground text-sm">{description}</p>
        </header>
        {tabs && tabs.length > 1 && navigationLabel ? (
          <ProjectTabs ariaLabel={navigationLabel} tabs={tabs} />
        ) : null}
        {children}
      </div>
    </WorkspacePageShell>
  );
}
