export const SIDEBAR_STATE_COOKIE_NAME = "sidebar_state";
export const SIDEBAR_STATE_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

/**
 * Window width below which the sidebar shows as the rail whatever the stored
 * preference says: a 14rem panel takes too much of a narrow window, and the
 * content beside it is the reason the window is open.
 *
 * The preference is untouched while the window is this narrow — it is restored
 * as soon as the window grows past this again.
 */
export const SIDEBAR_COMPACT_BREAKPOINT = 1024;

/**
 * Global the boot script installs so `SidebarProvider` can retire it once React
 * owns the sidebar attributes.
 */
export const SIDEBAR_BOOT_STOP_GLOBAL = "__sokosumiSidebarBootStop";

/** Read `sidebar_state` from a raw Cookie header / `document.cookie` string. */
export function parseSidebarStateCookieHeader(
  documentCookie: string,
): boolean | null {
  const match = documentCookie.match(
    new RegExp(`(?:^|;\\s*)${SIDEBAR_STATE_COOKIE_NAME}=([^;]*)`),
  );

  if (match?.[1] === "true") {
    return true;
  }

  if (match?.[1] === "false") {
    return false;
  }

  return null;
}

export function serializeSidebarStateCookie(open: boolean): string {
  return `${SIDEBAR_STATE_COOKIE_NAME}=${open}; path=/; max-age=${SIDEBAR_STATE_COOKIE_MAX_AGE}`;
}

/**
 * Pre-paint fixup for the collapsed rail.
 *
 * The app shell is a static Instant Nav prerender, so the layout cannot call
 * `cookies()` and every sidebar streams in expanded. `SidebarProvider` restores
 * the preference in `useLayoutEffect`, but that only runs after hydration —
 * seconds after the shell paints — which is the expanded-then-collapse flash.
 *
 * This runs before paint instead: when the cookie says collapsed — or the
 * window is below `SIDEBAR_COMPACT_BREAKPOINT`, where the rail is the default
 * whatever the cookie says — it rewrites `data-state` / `data-collapsible` on
 * each sidebar as it streams in, so the first frame is already the rail.
 * Hydration lands on the same values, so React never has to correct anything.
 * Only the cookie's own value is read; nothing is persisted here.
 *
 * Idempotent: a second run retires the previous observer before attaching its
 * own, so nothing is left observing the document.
 */
export const SIDEBAR_BOOT_SCRIPT = `(function(){try{
if(window.${SIDEBAR_BOOT_STOP_GLOBAL})window.${SIDEBAR_BOOT_STOP_GLOBAL}();
if(window.innerWidth>=${SIDEBAR_COMPACT_BREAKPOINT}&&!/(?:^|;\\s*)${SIDEBAR_STATE_COOKIE_NAME}=false(?:;|$)/.test(document.cookie))return;
var sync=function(){
var nodes=document.querySelectorAll('[data-slot="sidebar"][data-state="expanded"][data-collapsible-mode]');
for(var i=0;i<nodes.length;i++){var node=nodes[i];var mode=node.getAttribute('data-collapsible-mode');
if(!mode||mode==='none')continue;
node.setAttribute('data-state','collapsed');node.setAttribute('data-collapsible',mode);}};
sync();
var observer=new MutationObserver(sync);
observer.observe(document.documentElement,{childList:true,subtree:true});
window.${SIDEBAR_BOOT_STOP_GLOBAL}=function(){observer.disconnect();delete window.${SIDEBAR_BOOT_STOP_GLOBAL};};
}catch(_){}})();`;
