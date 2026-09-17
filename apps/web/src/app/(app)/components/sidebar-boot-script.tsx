import { SIDEBAR_BOOT_SCRIPT } from "@/lib/ui-preferences/sidebar-state";

/**
 * Applies the persisted collapsed preference before the shell paints. See
 * `SIDEBAR_BOOT_SCRIPT` for why this cannot be a `cookies()` read.
 */
export function SidebarBootScript() {
  return (
    <script
      data-cfasync="false"
      // Static string constant, no interpolated input.
      dangerouslySetInnerHTML={{ __html: SIDEBAR_BOOT_SCRIPT }}
    />
  );
}
