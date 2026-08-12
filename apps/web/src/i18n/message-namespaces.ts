import en from "../../messages/en.json";

const APP_FEATURE_EXCLUSIONS = new Set(["Hermes", "Admin"]);

function appMessagePathsExcluding(exclusions: ReadonlySet<string>): string[] {
  const app = (en as { App?: Record<string, unknown> }).App ?? {};
  return Object.keys(app)
    .filter((key) => !exclusions.has(key))
    .map((key) => `App.${key}`);
}

/** Root client provider — global chrome + 404. */
export const GLOBAL_MESSAGE_PATHS = [
  "Components",
  "Library",
  "NotFound",
  // The cookie banner renders on every route, including auth and error pages,
  // so its copy has to ship with the global bundle or it renders raw keys.
  "CookieConsent",
] as const;

/** Auth + invitation/join flows. */
export const AUTH_MESSAGE_PATHS = [
  "Auth",
  "Onboarding",
  "Library",
  "Components",
  "Join",
  "AcceptInvitation",
  "App.Account",
] as const;

/**
 * App shell chrome for nested Hermes/Admin providers.
 * Widened beyond the minimal sketch where sidebar/header overlays need keys.
 */
export const APP_SHELL_MESSAGE_PATHS = [
  "Components",
  "Library",
  "Onboarding",
  // Account Legal drill reopens the banner; nested app/Hermes/Admin
  // boundaries replace the global bag, so CookieConsent must travel with them.
  "CookieConsent",
  "App.Sidebar",
  "App.Header",
  "App.Error",
  "App.EmailVerificationNotice",
  "App.LowCreditsNotice",
  "App.NoticeDialog",
  "App.HistorySearchDialog",
  "App.History",
  "App.Metadata",
  "App.enabled",
  "App.disabled",
  "App.delete",
  "App.cancel",
  "App.save",
  "App.DesignMd",
  "App.Subscriptions",
  "App.Account",
  "App.Billing",
  "App.Channels.Presence",
  "App.Coworkers",
  "App.Developer",
  "App.MCP",
  "App.Tasks.Detail",
] as const;

/** Default authenticated app bag — all App.* except Hermes/Admin. */
export const APP_MESSAGE_PATHS = [
  "Components",
  "Library",
  "Onboarding",
  "CookieConsent",
  "notifications",
  ...appMessagePathsExcluding(APP_FEATURE_EXCLUSIONS),
] as const;

export const HERMES_MESSAGE_PATHS = [
  ...APP_SHELL_MESSAGE_PATHS,
  "App.Hermes",
] as const;

export const ADMIN_MESSAGE_PATHS = [
  ...APP_SHELL_MESSAGE_PATHS,
  "App.Admin",
] as const;

export const SHARE_MESSAGE_PATHS = [
  "Share",
  "Components",
  "Library",
  "Auth",
] as const;
