/**
 * Same-tab signal from the personal-assistant experience to the sidebar nav.
 * The nav polls its lightweight unread/identity endpoint every 30s — fine at
 * rest, but right after onboarding completes (or the assistant is renamed or
 * destroyed) a 30s-stale sidebar reads as broken. Dispatching this event on
 * identity changes lets the nav refetch immediately.
 */
export const HERMES_NAV_REFRESH_EVENT = "hermes:nav-refresh";

export function requestHermesNavRefresh(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(HERMES_NAV_REFRESH_EVENT));
}
