export const CHAT_UNREADS_FILTER_COOKIE_NAME = "chat_unreads_filter";
export const CHAT_UNREADS_FILTER_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * Set on `<html>` before paint while the reader left the Unreads filter on and
 * has not switched it since. The chat list reads it to hide the All list the
 * prerendered shell draws until React renders the filter from the cookie.
 */
export const CHAT_UNREADS_FILTER_BOOT_ATTRIBUTE = "data-chat-unreads-boot";

/** Read `chat_unreads_filter` from a raw Cookie header / `document.cookie`. */
export function parseChatUnreadsFilterCookieHeader(
  documentCookie: string,
): boolean {
  return new RegExp(
    `(?:^|;\\s*)${CHAT_UNREADS_FILTER_COOKIE_NAME}=true(?:;|$)`,
  ).test(documentCookie);
}

export function serializeChatUnreadsFilterCookie(on: boolean): string {
  return `${CHAT_UNREADS_FILTER_COOKIE_NAME}=${on}; path=/; max-age=${CHAT_UNREADS_FILTER_COOKIE_MAX_AGE}`;
}

/**
 * Pre-paint mark for a returning Unreads reader. The app shell is a static
 * prerender that cannot read cookies, so it always draws All; this marks the
 * page so that list stays hidden instead of showing and then switching.
 */
export const CHAT_UNREADS_FILTER_BOOT_SCRIPT = `(function(){try{
if(/(?:^|;\\s*)${CHAT_UNREADS_FILTER_COOKIE_NAME}=true(?:;|$)/.test(document.cookie))document.documentElement.setAttribute(${JSON.stringify(CHAT_UNREADS_FILTER_BOOT_ATTRIBUTE)},"");
}catch(_){}})();`;
