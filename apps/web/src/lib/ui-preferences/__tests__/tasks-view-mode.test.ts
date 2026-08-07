import { describe, expect, it } from "vitest";
import {
  parseTasksViewMode,
  parseTasksViewModeCookieHeader,
  preferTasksListFromDeviceType,
  preferTasksListFromUserAgent,
  resolveDefaultTasksViewMode,
  resolveTasksViewModeFromClientCookie,
  serializeTasksViewModeCookie,
  TASKS_VIEW_MODE_COOKIE_MAX_AGE,
  TASKS_VIEW_MODE_COOKIE_NAME,
} from "@/lib/ui-preferences/tasks-view-mode";

describe("parseTasksViewMode", () => {
  it("returns board for board", () => {
    expect(parseTasksViewMode("board")).toBe("board");
  });

  it("returns list for list", () => {
    expect(parseTasksViewMode("list")).toBe("list");
  });

  it("returns null for invalid values", () => {
    expect(parseTasksViewMode("grid")).toBeNull();
    expect(parseTasksViewMode("")).toBeNull();
    expect(parseTasksViewMode(null)).toBeNull();
    expect(parseTasksViewMode(undefined)).toBeNull();
  });
});

describe("preferTasksListFromDeviceType", () => {
  it("returns true for mobile and tablet", () => {
    expect(preferTasksListFromDeviceType("mobile")).toBe(true);
    expect(preferTasksListFromDeviceType("tablet")).toBe(true);
  });

  it("returns false for desktop and unknown", () => {
    expect(preferTasksListFromDeviceType(undefined)).toBe(false);
    expect(preferTasksListFromDeviceType("")).toBe(false);
    expect(preferTasksListFromDeviceType("console")).toBe(false);
  });
});

describe("resolveDefaultTasksViewMode", () => {
  it("prefers persisted cookie over device default", () => {
    expect(
      resolveDefaultTasksViewMode({
        persisted: "board",
        preferList: true,
      }),
    ).toBe("board");
    expect(
      resolveDefaultTasksViewMode({
        persisted: "list",
        preferList: false,
      }),
    ).toBe("list");
  });

  it("defaults to list on mobile when no cookie", () => {
    expect(
      resolveDefaultTasksViewMode({
        persisted: null,
        preferList: true,
      }),
    ).toBe("list");
  });

  it("defaults to board on desktop when no cookie", () => {
    expect(
      resolveDefaultTasksViewMode({
        persisted: null,
        preferList: false,
      }),
    ).toBe("board");
  });
});

describe("serializeTasksViewModeCookie", () => {
  it("serializes cookie with name, value, path, and max-age", () => {
    expect(serializeTasksViewModeCookie("list")).toBe(
      `${TASKS_VIEW_MODE_COOKIE_NAME}=list; path=/; max-age=${TASKS_VIEW_MODE_COOKIE_MAX_AGE}`,
    );
  });
});

describe("preferTasksListFromUserAgent", () => {
  it("returns true for phone and tablet UAs", () => {
    expect(
      preferTasksListFromUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
      ),
    ).toBe(true);
    expect(
      preferTasksListFromUserAgent(
        "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)",
      ),
    ).toBe(true);
    expect(
      preferTasksListFromUserAgent(
        "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Mobile",
      ),
    ).toBe(true);
    expect(
      preferTasksListFromUserAgent(
        "Mozilla/5.0 (Linux; Android 12; SM-T870) AppleWebKit/537.36",
      ),
    ).toBe(true);
  });

  it("returns false for desktop and missing UA", () => {
    expect(
      preferTasksListFromUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0.0.0",
      ),
    ).toBe(false);
    expect(preferTasksListFromUserAgent(undefined)).toBe(false);
    expect(preferTasksListFromUserAgent("")).toBe(false);
  });
});

describe("parseTasksViewModeCookieHeader", () => {
  it("reads tasks_view_mode from a cookie header", () => {
    expect(
      parseTasksViewModeCookieHeader(
        `other=1; ${TASKS_VIEW_MODE_COOKIE_NAME}=list; theme=dark`,
      ),
    ).toBe("list");
    expect(
      parseTasksViewModeCookieHeader(`${TASKS_VIEW_MODE_COOKIE_NAME}=board`),
    ).toBe("board");
  });

  it("returns null when missing or invalid", () => {
    expect(parseTasksViewModeCookieHeader("theme=dark")).toBeNull();
    expect(
      parseTasksViewModeCookieHeader(`${TASKS_VIEW_MODE_COOKIE_NAME}=grid`),
    ).toBeNull();
  });
});

describe("resolveTasksViewModeFromClientCookie", () => {
  it("prefers cookie over UA default", () => {
    expect(
      resolveTasksViewModeFromClientCookie(
        `${TASKS_VIEW_MODE_COOKIE_NAME}=board`,
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
      ),
    ).toBe("board");
    expect(
      resolveTasksViewModeFromClientCookie(
        `${TASKS_VIEW_MODE_COOKIE_NAME}=list`,
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0.0.0",
      ),
    ).toBe("list");
  });

  it("defaults to list on mobile UA without cookie", () => {
    expect(
      resolveTasksViewModeFromClientCookie(
        "",
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
      ),
    ).toBe("list");
  });

  it("defaults to board on desktop UA without cookie", () => {
    expect(
      resolveTasksViewModeFromClientCookie(
        "",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0.0.0",
      ),
    ).toBe("board");
  });
});
