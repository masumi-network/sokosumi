import type { Session } from "@sokosumi/utils";
import { WorkspaceSwitcher } from "@/app/components/workspace-switcher/workspace-switcher";
import { HeaderTrailingTools } from "./header-trailing-tools";

interface HeaderProfileSectionProps {
  session: Session;
}

/**
 * The top bar's trailing chrome. From md the Workspace switcher lives in the
 * sidebar header, so the desktop end is Notification Center alone (Search
 * sits before it); the phone keeps its switcher here, avatar only.
 */
export default function HeaderProfileSection({
  session,
}: HeaderProfileSectionProps) {
  return (
    <div className="flex h-8 items-center gap-1.5 md:h-auto">
      <div className="flex md:hidden">
        <WorkspaceSwitcher
          sessionUser={session.user}
          activeOrganizationId={session.session.activeOrganizationId ?? null}
        />
      </div>
      {/* Notification Center + mobile Search stay outside the switcher's
          Suspense, so they work while its workspaces load. */}
      <HeaderTrailingTools />
    </div>
  );
}
