import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  parseSidebarStateCookieHeader,
  SIDEBAR_BOOT_SCRIPT,
  SIDEBAR_BOOT_STOP_GLOBAL,
  serializeSidebarStateCookie,
} from "./sidebar-state";

function clearCookie() {
  document.cookie =
    "sidebar_state=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
}

function runBootScript() {
  new Function(SIDEBAR_BOOT_SCRIPT)();
}

function stopBootScript() {
  (window as typeof window & { [SIDEBAR_BOOT_STOP_GLOBAL]?: () => void })[
    SIDEBAR_BOOT_STOP_GLOBAL
  ]?.();
}

function appendSidebar(collapsibleMode: string | null) {
  const node = document.createElement("div");
  node.setAttribute("data-slot", "sidebar");
  node.setAttribute("data-state", "expanded");
  node.setAttribute("data-collapsible", "");
  if (collapsibleMode !== null) {
    node.setAttribute("data-collapsible-mode", collapsibleMode);
  }
  document.body.append(node);
  return node;
}

/** MutationObserver callbacks land on the microtask queue. */
function flushObservers() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("sidebar state cookie", () => {
  it("parses the persisted preference", () => {
    expect(parseSidebarStateCookieHeader("sidebar_state=false")).toBe(false);
    expect(parseSidebarStateCookieHeader("sidebar_state=true")).toBe(true);
    expect(
      parseSidebarStateCookieHeader("theme=dark; sidebar_state=false; a=b"),
    ).toBe(false);
  });

  it("returns null when the cookie is absent or unreadable", () => {
    expect(parseSidebarStateCookieHeader("")).toBeNull();
    expect(parseSidebarStateCookieHeader("theme=dark")).toBeNull();
    expect(parseSidebarStateCookieHeader("sidebar_state=maybe")).toBeNull();
    // A different cookie ending in the same name must not match.
    expect(parseSidebarStateCookieHeader("x_sidebar_state=false")).toBeNull();
  });

  it("serializes a site-wide, week-long preference", () => {
    expect(serializeSidebarStateCookie(false)).toBe(
      "sidebar_state=false; path=/; max-age=604800",
    );
    expect(serializeSidebarStateCookie(true)).toBe(
      "sidebar_state=true; path=/; max-age=604800",
    );
  });
});

describe("sidebar boot script", () => {
  beforeEach(() => {
    clearCookie();
    document.body.innerHTML = "";
  });

  afterEach(() => {
    stopBootScript();
    clearCookie();
    document.body.innerHTML = "";
  });

  it("collapses a sidebar already in the streamed markup", () => {
    document.cookie = "sidebar_state=false; path=/";
    const sidebar = appendSidebar("icon");

    runBootScript();

    expect(sidebar.getAttribute("data-state")).toBe("collapsed");
    expect(sidebar.getAttribute("data-collapsible")).toBe("icon");
  });

  it("collapses a sidebar that streams in after it runs", async () => {
    document.cookie = "sidebar_state=false; path=/";
    runBootScript();

    const sidebar = appendSidebar("icon");
    await flushObservers();

    expect(sidebar.getAttribute("data-state")).toBe("collapsed");
    expect(sidebar.getAttribute("data-collapsible")).toBe("icon");
  });

  it("leaves the sidebar expanded when the preference says so", () => {
    document.cookie = "sidebar_state=true; path=/";
    const sidebar = appendSidebar("icon");

    runBootScript();

    expect(sidebar.getAttribute("data-state")).toBe("expanded");
  });

  it("leaves the sidebar expanded when there is no preference", () => {
    const sidebar = appendSidebar("icon");

    runBootScript();

    expect(sidebar.getAttribute("data-state")).toBe("expanded");
  });

  it("skips sidebars that cannot collapse", () => {
    document.cookie = "sidebar_state=false; path=/";
    const withoutMode = appendSidebar(null);
    const none = appendSidebar("none");

    runBootScript();

    expect(withoutMode.getAttribute("data-state")).toBe("expanded");
    expect(none.getAttribute("data-state")).toBe("expanded");
  });

  it("stops rewriting once React takes over", async () => {
    document.cookie = "sidebar_state=false; path=/";
    runBootScript();

    stopBootScript();
    const sidebar = appendSidebar("icon");
    await flushObservers();

    expect(sidebar.getAttribute("data-state")).toBe("expanded");
  });
});
