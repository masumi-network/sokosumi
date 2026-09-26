import { CHAT_UNREADS_FILTER_BOOT_SCRIPT } from "@/lib/ui-preferences/chat-unreads-filter";
import { SIDEBAR_BOOT_SCRIPT } from "@/lib/ui-preferences/sidebar-state";

/**
 * Applies the persisted collapsed preference and the Unreads filter mark
 * before the shell paints. See `SIDEBAR_BOOT_SCRIPT` for why this cannot be a
 * `cookies()` read.
 */
export function SidebarBootScript() {
  return (
    <script
      id="sokosumi-sidebar-state"
      data-cfasync="false"
      // Static string constants, no interpolated input.
      dangerouslySetInnerHTML={{
        __html: SIDEBAR_BOOT_SCRIPT + CHAT_UNREADS_FILTER_BOOT_SCRIPT,
      }}
    />
  );
}
