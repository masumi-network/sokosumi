const SIDEBAR_STATE_COOKIE_NAME = "sidebar_state";
const SIDEBAR_STATE_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;
const SIDEBAR_WIDTH_COOKIE_NAME = "sidebar_width";

/**
 * The width the reader dragged the sidebar to, as a CSS variable on `<html>`.
 * The boot script sets it before paint from the cookie; the wrapper's
 * `--sidebar-width` reads it and falls back to the 14rem default.
 */
export const SIDEBAR_USER_WIDTH_VAR = "--sidebar-user-width";

/** Resizable range in px. `SIDEBAR_DEFAULT_WIDTH` is the 14rem it starts at. */
export const SIDEBAR_MIN_WIDTH = 192;
export const SIDEBAR_MAX_WIDTH = 384;
export const SIDEBAR_DEFAULT_WIDTH = 224;

/**
 * Dragging the edge left of this x (px from the window's left) collapses the
 * sidebar on release instead of resizing it. Under the minimum width, so a
 * drag that only reaches the minimum never collapses by accident.
 */
export const SIDEBAR_COLLAPSE_AT = 144;

export function clampSidebarWidth(px: number): number {
  return Math.round(
    Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, px)),
  );
}

/**
 * Window width below which the sidebar starts hidden whatever the stored
 * preference says: a 14rem panel takes too much of a narrow window, and the
 * content beside it is the reason the window is open.
 *
 * The preference is untouched while the window is this narrow — it is restored
 * as soon as the window grows past this again.
 */
const SIDEBAR_COMPACT_BREAKPOINT = 1024;

/**
 * The one predicate for 'this window is too narrow for the sidebar'.
 *
 * The boot script and `SidebarProvider` must agree exactly. They ran the
 * same number through two different APIs before — `window.innerWidth` in the
 * script, `matchMedia` in React — and at a fractional or rounded viewport
 * width those can land on opposite sides of the edge, which shows up as the
 * one-frame flash the boot script exists to prevent.
 */
export const SIDEBAR_COMPACT_MEDIA_QUERY = `(max-width: ${
  SIDEBAR_COMPACT_BREAKPOINT - 1
}px)`;

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

/** Read `sidebar_width` (px) from a raw Cookie header / `document.cookie`. */
export function parseSidebarWidthCookieHeader(
  documentCookie: string,
): number | null {
  const match = documentCookie.match(
    new RegExp(`(?:^|;\\s*)${SIDEBAR_WIDTH_COOKIE_NAME}=(\\d+)(?:;|$)`),
  );
  const px = match?.[1] ? Number(match[1]) : null;

  return px !== null && px >= SIDEBAR_MIN_WIDTH && px <= SIDEBAR_MAX_WIDTH
    ? px
    : null;
}

export function serializeSidebarWidthCookie(px: number): string {
  return `${SIDEBAR_WIDTH_COOKIE_NAME}=${clampSidebarWidth(px)}; path=/; max-age=${SIDEBAR_STATE_COOKIE_MAX_AGE}`;
}

/**
 * Pre-paint fixup for the hidden sidebar.
 *
 * The app shell is a static Instant Nav prerender, so the layout cannot call
 * `cookies()` and every sidebar streams in shown. `SidebarProvider` restores
 * the preference in `useLayoutEffect`, but that only runs after hydration —
 * seconds after the shell paints — which is the shown-then-hidden flash.
 *
 * This runs before paint instead: when the cookie says hidden — or the window
 * is below `SIDEBAR_COMPACT_BREAKPOINT`, where hidden is the default whatever
 * the cookie says — it rewrites `data-state` / `data-collapsible` on each
 * sidebar as it streams in, so the first frame is already hidden.
 * Hydration lands on the same values, so React never has to correct anything.
 * It also applies the dragged width (`sidebar_width`) as a variable on
 * `<html>`, whichever way the sidebar starts. Only the cookies' own values
 * are read; nothing is persisted here.
 *
 * Idempotent: a second run retires the previous observer before attaching its
 * own, so nothing is left observing the document.
 */
export const SIDEBAR_BOOT_SCRIPT = `(function(){try{
if(window.${SIDEBAR_BOOT_STOP_GLOBAL})window.${SIDEBAR_BOOT_STOP_GLOBAL}();
var width=document.cookie.match(/(?:^|;\\s*)${SIDEBAR_WIDTH_COOKIE_NAME}=(\\d+)(?:;|$)/);
if(width&&+width[1]>=${SIDEBAR_MIN_WIDTH}&&+width[1]<=${SIDEBAR_MAX_WIDTH})document.documentElement.style.setProperty('${SIDEBAR_USER_WIDTH_VAR}',width[1]+'px');
var compact=window.matchMedia(${JSON.stringify(SIDEBAR_COMPACT_MEDIA_QUERY)}).matches;
if(!compact&&!/(?:^|;\\s*)${SIDEBAR_STATE_COOKIE_NAME}=false(?:;|$)/.test(document.cookie))return;
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
