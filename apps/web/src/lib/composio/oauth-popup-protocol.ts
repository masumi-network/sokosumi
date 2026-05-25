/**
 * Shared protocol for the Composio OAuth popup ↔ opener handshake.
 *
 * `postMessage` via `window.opener` breaks once the popup navigates to
 * Composio: COOP puts cross-origin OAuth pages in a separate browsing context
 * group, so the opener cannot read `popup.closed` and the callback may have no
 * `window.opener`. {@link BroadcastChannel} delivers on same-origin regardless
 * of COOP, which is the reliable path for third-party OAuth.
 */
export const COMPOSIO_OAUTH_BROADCAST_CHANNEL = "sokosumi:composio:oauth";

export const COMPOSIO_OAUTH_MESSAGE_TYPE = "sokosumi:composio:result" as const;
export const COMPOSIO_OAUTH_ACK_TYPE = "sokosumi:composio:ack" as const;

export type ComposioOAuthCallbackStatus = "success" | "error";

export interface ComposioOAuthCallbackPayload {
  type: typeof COMPOSIO_OAUTH_MESSAGE_TYPE;
  status: ComposioOAuthCallbackStatus;
  connectionId: string | null;
  errorMessage: string | null;
}

export interface ComposioOAuthAckPayload {
  type: typeof COMPOSIO_OAUTH_ACK_TYPE;
}

export function isComposioOAuthCallbackPayload(
  value: unknown,
): value is ComposioOAuthCallbackPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === COMPOSIO_OAUTH_MESSAGE_TYPE
  );
}

export function isComposioOAuthAckPayload(
  value: unknown,
): value is ComposioOAuthAckPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === COMPOSIO_OAUTH_ACK_TYPE
  );
}

/**
 * COOP may block reading `Window.closed` while the popup is on a third-party
 * origin. Treat blocked access as "unknown" (not closed) so we do not resolve
 * the flow early or spam the console during the OAuth redirect.
 */
export function readPopupClosed(popup: Window): boolean | null {
  try {
    return popup.closed;
  } catch {
    return null;
  }
}

export function parseComposioCallbackSearchParams(
  search: string,
): Omit<ComposioOAuthCallbackPayload, "type"> {
  const params = new URLSearchParams(
    search.startsWith("?") ? search : `?${search}`,
  );
  const rawStatus = (params.get("status") ?? "").toLowerCase();
  const connectionId =
    params.get("connectedAccountId") ??
    params.get("connected_account_id") ??
    params.get("connectionId") ??
    params.get("id");
  const errorMessage = params.get("error") ?? params.get("error_description");

  const isExplicitFailure =
    rawStatus === "failed" ||
    rawStatus === "error" ||
    rawStatus === "expired" ||
    rawStatus === "inactive" ||
    Boolean(errorMessage);

  const status: ComposioOAuthCallbackStatus = isExplicitFailure
    ? "error"
    : rawStatus === "success" || rawStatus === "active" || connectionId
      ? "success"
      : "error";

  return { status, connectionId, errorMessage };
}

/** Inline script for `/composio/callback` — runs during HTML parse, before paint. */
export function buildComposioCallbackInlineScript(): string {
  const channel = COMPOSIO_OAUTH_BROADCAST_CHANNEL;
  const messageType = COMPOSIO_OAUTH_MESSAGE_TYPE;
  const ackType = COMPOSIO_OAUTH_ACK_TYPE;

  return `(function(){try{
var p=new URLSearchParams(window.location.search);
var rawStatus=(p.get("status")||"").toLowerCase();
var connectionId=p.get("connectedAccountId")||p.get("connected_account_id")||p.get("connectionId")||p.get("id");
var errorMessage=p.get("error")||p.get("error_description");
var failed=rawStatus==="failed"||rawStatus==="error"||rawStatus==="expired"||rawStatus==="inactive"||!!errorMessage;
var status=failed?"error":(rawStatus==="success"||rawStatus==="active"||connectionId?"success":"error");
var payload={type:${JSON.stringify(messageType)},status:status,connectionId:connectionId,errorMessage:errorMessage};
var origin=window.location.origin;
function closePopup(){try{window.close()}catch(e){}}
window.addEventListener("message",function onAck(ev){
if(ev.origin!==origin)return;
if(!ev.data||ev.data.type!==${JSON.stringify(ackType)})return;
window.removeEventListener("message",onAck);
closePopup();
});
var bc=new BroadcastChannel(${JSON.stringify(channel)});
bc.postMessage(payload);
bc.close();
if(window.opener){try{window.opener.postMessage(payload,origin)}catch(e){}}
closePopup();
setTimeout(closePopup,150);
}catch(e){}})();`;
}
