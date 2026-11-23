import {
  hasOAuthScope,
  OAUTH_SCOPE_CORE_API,
  OAUTH_SCOPE_MCP,
  OAUTH_SCOPE_OFFLINE_ACCESS,
} from "@sokosumi/utils";
import { useTranslations } from "next-intl";

interface ConsentDetailsProps {
  clientName: string;
  scope: string | null;
  /** The signed request's `redirect_uri`; Core checked it against the client. */
  redirectUri: string | null;
  /** From Core: the client has no owner (dynamic registration). */
  selfRegistered: boolean | undefined;
}

/** Who asks, what they get, and, for an unverified app, where you go next. */
export function ConsentDetails({
  clientName,
  scope,
  redirectUri,
  selfRegistered,
}: ConsentDetailsProps) {
  const t = useTranslations("App.Account.OAuthConsent");
  // Fail closed: only a client Core says has an owner skips the note.
  const unverified = selfRegistered !== false;
  const host = unverified ? readRedirectHost(redirectUri) : null;

  return (
    <div>
      <p className="mb-1 font-semibold">{clientName}</p>
      <p className="text-muted-foreground text-sm">{t("wantsAccess")}</p>
      {unverified ? (
        <p className="mt-2 text-sm">{t("unverifiedNotice")}</p>
      ) : null}
      {host ? (
        <p className="text-muted-foreground mt-1 text-sm">
          {t("redirectHost", { host })}
        </p>
      ) : null}
      {hasOAuthScope(scope, OAUTH_SCOPE_CORE_API) ? (
        <p className="text-muted-foreground mt-2 text-sm">
          {t("apiAccessNotice")}
        </p>
      ) : null}
      {hasOAuthScope(scope, OAUTH_SCOPE_MCP) ? (
        <p className="text-muted-foreground mt-2 text-sm">
          {t("mcpAccessNotice")}
        </p>
      ) : null}
      {hasOAuthScope(scope, OAUTH_SCOPE_OFFLINE_ACCESS) ? (
        <p className="text-muted-foreground mt-2 text-sm">
          {t("offlineAccessNotice")}
        </p>
      ) : null}
    </div>
  );
}

/** `app.example.com`, `127.0.0.1:33418`, or a native app's scheme. */
function readRedirectHost(redirectUri: string | null): string | null {
  if (!(redirectUri && URL.canParse(redirectUri))) {
    return null;
  }
  const url = new URL(redirectUri);
  return url.host || url.protocol.slice(0, -1);
}
