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
export const COMPOSIO_OAUTH_POPUP_NAME_PREFIX =
  "sokosumi:composio:oauth:" as const;

export const COMPOSIO_OAUTH_MESSAGE_TYPE = "sokosumi:composio:result" as const;
export const COMPOSIO_OAUTH_ACK_TYPE = "sokosumi:composio:ack" as const;

export type ComposioOAuthCallbackStatus = "success" | "error";

export interface ComposioOAuthCallbackPayload {
  type: typeof COMPOSIO_OAUTH_MESSAGE_TYPE;
  status: ComposioOAuthCallbackStatus;
  connectionId: string | null;
  sessionUri: string | null;
  errorMessage: string | null;
  nonce: string;
}

export interface ComposioOAuthAckPayload {
  type: typeof COMPOSIO_OAUTH_ACK_TYPE;
  nonce: string;
}

export interface ComposioOAuthCallbackResult {
  status: ComposioOAuthCallbackStatus;
  connectionId: string | null;
  sessionUri: string | null;
  errorMessage: string | null;
}

export function getComposioOAuthPopupName(nonce: string): string {
  return `${COMPOSIO_OAUTH_POPUP_NAME_PREFIX}${nonce}`;
}

export function getComposioOAuthBroadcastChannelName(nonce: string): string {
  return `${COMPOSIO_OAUTH_BROADCAST_CHANNEL}:${nonce}`;
}

export function isComposioOAuthCallbackPayload(
  value: unknown,
): value is ComposioOAuthCallbackPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === COMPOSIO_OAUTH_MESSAGE_TYPE &&
    typeof (value as { nonce?: unknown }).nonce === "string"
  );
}

export function isComposioOAuthAckPayload(
  value: unknown,
): value is ComposioOAuthAckPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === COMPOSIO_OAUTH_ACK_TYPE &&
    typeof (value as { nonce?: unknown }).nonce === "string"
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
): ComposioOAuthCallbackResult {
  const params = new URLSearchParams(
    search.startsWith("?") ? search : `?${search}`,
  );
  const rawStatus = (params.get("status") ?? "").toLowerCase();
  const connectionId =
    params.get("connectedAccountId") ??
    params.get("connected_account_id") ??
    params.get("connectionId") ??
    params.get("id");
  const sessionUri = params.get("session_uri") ?? params.get("sessionUri");
  const errorMessage = params.get("error") ?? params.get("error_description");

  const isExplicitFailure =
    rawStatus === "failed" ||
    rawStatus === "error" ||
    rawStatus === "expired" ||
    rawStatus === "inactive" ||
    Boolean(errorMessage);

  const status: ComposioOAuthCallbackStatus = isExplicitFailure
    ? "error"
    : rawStatus === "success" ||
        rawStatus === "active" ||
        connectionId ||
        sessionUri
      ? "success"
      : "error";

  return { status, connectionId, sessionUri, errorMessage };
}

/** Inline script for `/composio/callback` — runs during HTML parse, before paint. */
export function buildComposioCallbackInlineScript(): string {
  const channel = COMPOSIO_OAUTH_BROADCAST_CHANNEL;
  const popupNamePrefix = COMPOSIO_OAUTH_POPUP_NAME_PREFIX;
  const messageType = COMPOSIO_OAUTH_MESSAGE_TYPE;
  const ackType = COMPOSIO_OAUTH_ACK_TYPE;

  return `(function(){
try{
var popupName=window.name;
if(popupName.indexOf(${JSON.stringify(popupNamePrefix)})!==0)return;
var nonce=popupName.slice(${JSON.stringify(popupNamePrefix)}.length);
if(!nonce)return;
var p=new URLSearchParams(window.location.search);
var rawStatus=(p.get("status")||"").toLowerCase();
var connectionId=p.get("connectedAccountId")||p.get("connected_account_id")||p.get("connectionId")||p.get("id");
var sessionUri=p.get("session_uri")||p.get("sessionUri");
var errorMessage=p.get("error")||p.get("error_description");
var failed=rawStatus==="failed"||rawStatus==="error"||rawStatus==="expired"||rawStatus==="inactive"||!!errorMessage;
var status=failed?"error":(rawStatus==="success"||rawStatus==="active"||connectionId||sessionUri?"success":"error");
var payload={type:${JSON.stringify(messageType)},status:status,connectionId:connectionId,sessionUri:sessionUri,errorMessage:errorMessage,nonce:nonce};
var origin=window.location.origin;
function closePopup(){try{window.close()}catch(e){}}
window.addEventListener("message",function onAck(ev){
if(ev.origin!==origin)return;
if(!ev.data||ev.data.type!==${JSON.stringify(ackType)})return;
if(ev.data.nonce!==nonce)return;
window.removeEventListener("message",onAck);
closePopup();
});
}catch(e){return;}
try{
if(typeof BroadcastChannel!=="undefined"){
var bc=new BroadcastChannel(${JSON.stringify(channel)}+":"+nonce);
bc.postMessage(payload);
bc.close();
}
}catch(e){}
if(window.opener){try{window.opener.postMessage(payload,origin)}catch(e){}}
closePopup();
setTimeout(closePopup,150);
})();`;
}
