import { LIST_MOBILE_CREATE_FAB_CLEARANCE } from "@/app/components/mobile-create-fab-geometry";
import { WorkspacePageShell } from "@/app/components/workspace-page-shell";

/**
 * Social as a destination of its own.
 *
 * Same shell as Ads and other project-scoped pages, plus bottom clearance for
 * the mobile create FAB.
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
    <WorkspacePageShell
      className={LIST_MOBILE_CREATE_FAB_CLEARANCE}
      title={title}
    >
      {children}
    </WorkspacePageShell>
  );
}
