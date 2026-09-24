import { afterEach, describe, expect, it } from "vitest";

import {
  CHAT_UNREADS_FILTER_BOOT_ATTRIBUTE,
  CHAT_UNREADS_FILTER_BOOT_SCRIPT,
  CHAT_UNREADS_FILTER_COOKIE_NAME,
  parseChatUnreadsFilterCookieHeader,
  serializeChatUnreadsFilterCookie,
} from "./chat-unreads-filter";
import { SIDEBAR_BOOT_SCRIPT } from "./sidebar-state";

function clearCookie() {
  document.cookie = `${CHAT_UNREADS_FILTER_COOKIE_NAME}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

describe("Unreads filter cookie", () => {
  it("reads the filter as on only when the reader turned it on", () => {
    expect(parseChatUnreadsFilterCookieHeader("chat_unreads_filter=true")).toBe(
      true,
    );
    expect(
      parseChatUnreadsFilterCookieHeader("a=b; chat_unreads_filter=true; c=d"),
    ).toBe(true);
    expect(
      parseChatUnreadsFilterCookieHeader("chat_unreads_filter=false"),
    ).toBe(false);
    expect(parseChatUnreadsFilterCookieHeader("")).toBe(false);
    // A different cookie ending in the same name must not match.
    expect(
      parseChatUnreadsFilterCookieHeader("x_chat_unreads_filter=true"),
    ).toBe(false);
  });

  it("serializes a site-wide, year-long preference", () => {
    expect(serializeChatUnreadsFilterCookie(true)).toBe(
      "chat_unreads_filter=true; path=/; max-age=31536000",
    );
    expect(serializeChatUnreadsFilterCookie(false)).toBe(
      "chat_unreads_filter=false; path=/; max-age=31536000",
    );
  });
});

describe("Unreads filter boot script", () => {
  afterEach(() => {
    clearCookie();
    document.documentElement.removeAttribute(
      CHAT_UNREADS_FILTER_BOOT_ATTRIBUTE,
    );
  });

  it("marks the page before paint when the reader left the filter on", () => {
    document.cookie = serializeChatUnreadsFilterCookie(true);

    new Function(CHAT_UNREADS_FILTER_BOOT_SCRIPT)();

    expect(
      document.documentElement.hasAttribute(CHAT_UNREADS_FILTER_BOOT_ATTRIBUTE),
    ).toBe(true);
  });

  // Shipped after the sidebar's script in one tag, whose early return for an
  // expanded sidebar must not skip this one.
  it("marks the page when run after the sidebar's script", () => {
    document.cookie = serializeChatUnreadsFilterCookie(true);

    new Function(SIDEBAR_BOOT_SCRIPT + CHAT_UNREADS_FILTER_BOOT_SCRIPT)();

    expect(
      document.documentElement.hasAttribute(CHAT_UNREADS_FILTER_BOOT_ATTRIBUTE),
    ).toBe(true);
  });

  it("leaves the page alone when the filter is off", () => {
    document.cookie = serializeChatUnreadsFilterCookie(false);

    new Function(CHAT_UNREADS_FILTER_BOOT_SCRIPT)();

    expect(
      document.documentElement.hasAttribute(CHAT_UNREADS_FILTER_BOOT_ATTRIBUTE),
    ).toBe(false);
  });
});
