import { SOKO_BOT_ID_PARAM } from "@/lib/soko-bot/bot-id-param";
import { SOKO_BOT_ROUTE } from "@/lib/soko-bot/constants";

/**
 * Shared protocol for the Composio OAuth popup ↔ opener handshake.
 *
 * `postMessage` via `window.opener` breaks once the popup navigates to
 * Composio: COOP puts cross-origin OAuth pages in a separate browsing context
 * group, so the opener cannot read `popup.closed` and the callback may have no
 * `window.opener`. {@link BroadcastChannel} delivers on same-origin regardless
 * of COOP, which is the reliable path for third-party OAuth.
 */
export const COMPOSIO_OAUTH_NONCE_STORAGE_KEY = "sokosumi:composio:nonce";
export const COMPOSIO_CALLBACK_PATH = "/composio/callback";
export const COMPOSIO_BOT_VERIFIER_PATH = `${SOKO_BOT_ROUTE}/integrations/verify`;
export const COMPOSIO_OWNER_VERIFICATION_PARAM =
  "__sokosumi_owner_verification";

/**
 * The one page of a Sokosumi host that a return from Composio may go to. A
 * return can hold a one-use session: whoever reads it, signed in as the user
 * who started the connection, can finish that connection. It goes to the page
 * that redeems it, on this host or on a preview named below, and to no other
 * Sokosumi page.
 */
export const COMPOSIO_MANAGED_RETURN_PATH = "/seo/connections/callback";
/**
 * Preprod's Web host, and Web's Preprod pull-request previews. Preprod can
 * return there, so a preview can finish a connection. A preview runs the code
 * of its branch, so this trusts every branch that gets a Preprod preview; no
 * other network does. The host is named, not read from the environment: this
 * page is built one time, and an unset variable must not open Mainnet.
 */
const PREPROD_WEB_HOST = "preprod.sokosumi.com";
const PREPROD_PREVIEW_HOST =
  /^sokosumi-app-preprod-git-[a-z0-9-]+\.preview\.sokosumi\.com$/;
const SOKOSUMI_HOST = /(^|\.)sokosumi\.com$/;

/**
 * The shared bot a same-tab connection is for. Composio returns to the fixed
 * callback page, not to our return URL, so the tab keeps the id for it.
 */
export const COMPOSIO_BOT_ID_STORAGE_KEY = "sokosumi:composio:bot-id";

/** Remember (or forget) the shared bot before the tab leaves for Composio. */
export function rememberComposioBotId(botId?: string | null): void {
  try {
    if (botId)
      window.sessionStorage.setItem(COMPOSIO_BOT_ID_STORAGE_KEY, botId);
    else window.sessionStorage.removeItem(COMPOSIO_BOT_ID_STORAGE_KEY);
  } catch {
    // No storage: the verifier then settles the caller's own bot.
  }
}

/**
 * Where a connect started in another first-party app (CMO) returns. Its tab
 * passes Web's hand-off page on the way to Composio, so the fixed callback
 * page can send the browser back to that app.
 */
export const COMPOSIO_HANDOFF_STORAGE_KEY = "sokosumi:composio:handoff";
/** A hand-off older than this belongs to an abandoned connect. */
const COMPOSIO_HANDOFF_TTL_MS = 15 * 60_000;

/** Composio's hosted connect pages. */
function isComposioUrl(url: URL): boolean {
  return (
    url.protocol === "https:" &&
    (url.hostname === "composio.dev" || url.hostname.endsWith(".composio.dev"))
  );
}

/** A page of a first-party app; local hosts only in development. */
function isFirstPartyReturnUrl(url: URL, allowLocal: boolean): boolean {
  if (url.username || url.password || url.hash) return false;
  const host = url.hostname;
  if (url.protocol === "https:") {
    return ["sokosumi.com", "cmo.xyz"].some(
      (domain) => host === domain || host.endsWith(`.${domain}`),
    );
  }
  return (
    allowLocal &&
    url.protocol === "http:" &&
    (host === "localhost" || host === "127.0.0.1")
  );
}

export interface ComposioHandoff {
  to: string;
  returnUrl: string;
  connectionId: string | null;
}

/** The hand-off's addresses, or null when either is not one we send people to. */
export function readComposioHandoff(
  params: URLSearchParams,
): ComposioHandoff | null {
  const to = URL.parse(params.get("to") ?? "");
  const back = URL.parse(params.get("return") ?? "");
  if (
    !to ||
    !back ||
    !isComposioUrl(to) ||
    !isFirstPartyReturnUrl(back, process.env.NODE_ENV === "development")
  ) {
    return null;
  }
  return {
    to: to.toString(),
    returnUrl: back.toString(),
    connectionId: params.get("connection"),
  };
}

/** JSON for an inline script: no `</script>` can close it early. */
function inlineJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

/** Remembers where to return in this tab, then leaves for Composio. */
export function buildComposioHandoffInlineScript(
  handoff: ComposioHandoff,
): string {
  const stored = {
    returnUrl: handoff.returnUrl,
    connectionId: handoff.connectionId,
  };
  return `(function(){
var name=typeof window.name==="string"?window.name:"";
var popupNonce=name.indexOf(${inlineJson(COMPOSIO_OAUTH_POPUP_NAME_PREFIX)})===0?name.slice(${COMPOSIO_OAUTH_POPUP_NAME_PREFIX.length}):null;
if(!popupNonce)popupNonce=null;
try{
window.sessionStorage.setItem(${inlineJson(COMPOSIO_HANDOFF_STORAGE_KEY)},JSON.stringify(Object.assign(${inlineJson(stored)},{popupNonce:popupNonce,at:Date.now()})));
window.sessionStorage.removeItem(${inlineJson(COMPOSIO_OAUTH_NONCE_STORAGE_KEY)});
}catch(e){}
window.location.replace(${inlineJson(handoff.to)});
})();`;
}

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

/**
 * Inline callback script. Popup session storage survives cross-site redirects
 * that clear window.name and opener, including verifier redirects with no state.
 * Keep the name fallback for OAuth attempts opened before rollout.
 * Same-tab bot connections have no popup nonce and use the signed-in verifier.
 */
export function buildComposioCallbackInlineScript(): string {
  const channel = COMPOSIO_OAUTH_BROADCAST_CHANNEL;
  const storageKey = COMPOSIO_OAUTH_NONCE_STORAGE_KEY;
  const popupNamePrefix = COMPOSIO_OAUTH_POPUP_NAME_PREFIX;
  const messageType = COMPOSIO_OAUTH_MESSAGE_TYPE;
  const ackType = COMPOSIO_OAUTH_ACK_TYPE;
  const botVerifierPath = COMPOSIO_BOT_VERIFIER_PATH;
  const botIdKey = COMPOSIO_BOT_ID_STORAGE_KEY;
  const returnUrlValidator = isFirstPartyReturnUrl.toString();
  const allowLocalReturn = process.env.NODE_ENV === "development";

  return `(function(){
try{
var p=new URLSearchParams(window.location.search);
var popupName=typeof window.name==="string"?window.name:"";
var namedNonce=popupName.indexOf(${JSON.stringify(popupNamePrefix)})===0?popupName.slice(${JSON.stringify(popupNamePrefix)}.length):"";
var nonce="";
try{
nonce=window.sessionStorage.getItem(${JSON.stringify(storageKey)})||"";
window.sessionStorage.removeItem(${JSON.stringify(storageKey)});
}catch(e){}
var sessionUri=p.get("session_uri")||p.get("sessionUri");
var connectionId=p.get("connectedAccountId")||p.get("connected_account_id")||p.get("connectionId")||p.get("id");
if(!nonce){
var handoff=null;
try{
handoff=JSON.parse(window.sessionStorage.getItem(${JSON.stringify(COMPOSIO_HANDOFF_STORAGE_KEY)})||"null");
window.sessionStorage.removeItem(${JSON.stringify(COMPOSIO_HANDOFF_STORAGE_KEY)});
}catch(e){}
var back=null;
try{
var now=Date.now();
var validConnection=handoff&&(handoff.connectionId===null||handoff.connectionId===undefined||(typeof handoff.connectionId==="string"&&handoff.connectionId.length>0));
var validPopupNonce=handoff&&(handoff.popupNonce===null||handoff.popupNonce===undefined||(typeof handoff.popupNonce==="string"&&handoff.popupNonce.length>0));
if(handoff&&typeof handoff.returnUrl==="string"&&typeof handoff.at==="number"&&Number.isFinite(handoff.at)&&handoff.at<=now&&now-handoff.at<${COMPOSIO_HANDOFF_TTL_MS}&&validConnection&&validPopupNonce&&(!namedNonce||handoff.popupNonce===namedNonce)){
var candidate=new URL(handoff.returnUrl);
var here=candidate.origin===window.location.origin;
var preview=window.location.hostname===${JSON.stringify(PREPROD_WEB_HOST)}&&candidate.port===""&&new RegExp(${JSON.stringify(PREPROD_PREVIEW_HOST.source)}).test(candidate.hostname);
var redeems=candidate.pathname===${JSON.stringify(COMPOSIO_MANAGED_RETURN_PATH)}&&(here||preview);
var sokosumi=new RegExp(${JSON.stringify(SOKOSUMI_HOST.source)}).test(candidate.hostname);
if((${returnUrlValidator})(candidate,${allowLocalReturn})&&(!sokosumi||redeems))back=candidate;
}
}catch(e){}
if(back){
var mismatch=handoff.connectionId&&connectionId&&handoff.connectionId!==connectionId;
["session_uri","sessionUri","connected_account_id","connectedAccountId","connectionId","id","status","error","error_description"].forEach(function(k){back.searchParams.delete(k)});
if(mismatch){
back.searchParams.set("status","error");
back.searchParams.set("error","connection_mismatch");
}else{
if(sessionUri)back.searchParams.set("session_uri",sessionUri);
["status","error","error_description"].forEach(function(k){if(p.has(k))back.searchParams.set(k,p.get(k))});
}
if(handoff.connectionId||connectionId)back.searchParams.set("connected_account_id",handoff.connectionId||connectionId);
window.location.replace(back.toString());
return;
}
nonce=namedNonce;
}
if(!nonce){
var botId="";
try{
botId=window.sessionStorage.getItem(${JSON.stringify(botIdKey)})||"";
window.sessionStorage.removeItem(${JSON.stringify(botIdKey)});
}catch(e){}
if(sessionUri)window.location.replace(${JSON.stringify(botVerifierPath)}+"?session_uri="+encodeURIComponent(sessionUri)+"&${COMPOSIO_OWNER_VERIFICATION_PARAM}=1"+(botId?"&${SOKO_BOT_ID_PARAM}="+encodeURIComponent(botId):""));
return;
}
var rawStatus=(p.get("status")||"").toLowerCase();
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
