import { HeaderPhoneWorkspaceSwitcher } from "./header-phone-workspace-switcher.client";
import { HeaderTrailingTools } from "./header-trailing-tools";

/**
 * The top bar's trailing chrome. From md the Workspace switcher and Search
 * live in the sidebar header, so the desktop end is Notification Center
 * alone; the phone keeps its switcher here, avatar only (not on a project's
 * own pages), and its Search. The provider behind both switcher placements
 * is the app frame's.
 */
export default function HeaderProfileSection() {
  return (
    <div className="flex h-8 items-center gap-1.5 md:h-auto">
      <HeaderPhoneWorkspaceSwitcher />
      <HeaderTrailingTools />
    </div>
  );
}
