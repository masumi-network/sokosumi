import { act } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import {
  CHAT_UNREADS_FILTER_BOOT_ATTRIBUTE,
  CHAT_UNREADS_FILTER_COOKIE_NAME,
  serializeChatUnreadsFilterCookie,
} from "@/lib/ui-preferences/chat-unreads-filter";

import { useChatUnreadsFilter } from "./use-chat-unreads-filter";

function Probe() {
  const [on] = useChatUnreadsFilter();
  return <span>{on ? "on" : "off"}</span>;
}

describe("useChatUnreadsFilter hydration", () => {
  let root: Root | undefined;

  afterEach(() => {
    root?.unmount();
    root = undefined;
    document.body.innerHTML = "";
    document.cookie = `${CHAT_UNREADS_FILTER_COOKIE_NAME}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
    document.documentElement.removeAttribute(
      CHAT_UNREADS_FILTER_BOOT_ATTRIBUTE,
    );
  });

  // The server render is All. Clearing the mark when this list then agrees
  // unhides a sibling All list that has not hydrated yet.
  it("keeps the boot mark after hydration catches up to the cookie", async () => {
    document.cookie = serializeChatUnreadsFilterCookie(true);
    document.documentElement.setAttribute(
      CHAT_UNREADS_FILTER_BOOT_ATTRIBUTE,
      "",
    );
    const html = renderToString(<Probe />);
    expect(html).toContain("off");
    document.body.innerHTML = `<div id="root">${html}</div>`;

    await act(async () => {
      root = hydrateRoot(document.getElementById("root")!, <Probe />);
    });

    expect(document.getElementById("root")?.textContent).toBe("on");
    expect(
      document.documentElement.hasAttribute(CHAT_UNREADS_FILTER_BOOT_ATTRIBUTE),
    ).toBe(true);
  });
});
