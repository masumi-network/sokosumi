import { WorkspacePageShell } from "@/app/components/workspace-page-shell";
import type { ProjectTab } from "@/app/projects/components/project-tabs";
import { CmoProjectBanner } from "@/components/cmo-project-banner";

import { NewsletterTabs } from "./newsletter-tabs";

/**
 * Newsletter as a destination of its own, in the same shell as Social. It opens
 * without a visible headline: the sidebar's project selector, which reads
 * `?projectId=`, already says whose newsletter this is.
 *
 * A single tab is not navigation (setup has only Settings), so the bar shows
 * once there is somewhere else to go.
 */
export function NewsletterPageShell({
  children,
  cmoProjectId,
  navigationLabel,
  tabs,
  title,
}: {
  children: React.ReactNode;
  /** A CMO Project's id: the "Managed by CMO" banner leads the page. */
  cmoProjectId?: string;
  navigationLabel?: string;
  tabs?: readonly ProjectTab[];
  /** The `sr-only` page title, as on Social. */
  title: string;
}) {
  return (
    <WorkspacePageShell title={title}>
      <div className="min-w-0 space-y-6">
        {cmoProjectId ? <CmoProjectBanner projectId={cmoProjectId} /> : null}
        {tabs && tabs.length > 1 && navigationLabel ? (
          <NewsletterTabs ariaLabel={navigationLabel} tabs={tabs} />
        ) : null}
        {children}
      </div>
    </WorkspacePageShell>
  );
}
