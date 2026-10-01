import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let pathname = "/tasks/SOK-12";

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}));

import { TaskCanonicalUrl } from "./task-canonical-url";

const UUID = "550e8400-e29b-41d4-a716-446655440000";

describe("TaskCanonicalUrl", () => {
  const replaceState = vi.spyOn(window.history, "replaceState");

  beforeEach(() => {
    replaceState.mockClear();
  });

  function open(path: string) {
    pathname = path.split(/[?#]/)[0] ?? path;
    window.history.pushState(null, "", path);
    replaceState.mockClear();
  }

  it("replaces a bare or stale identifier URL, keeping search and hash", () => {
    open("/tasks/SOK-12?tab=jobs#comment-3");

    render(<TaskCanonicalUrl href="/tasks/SOK-12-fix-login" />);

    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(replaceState).toHaveBeenCalledWith(
      window.history.state,
      "",
      "/tasks/SOK-12-fix-login?tab=jobs#comment-3",
    );
    expect(window.location.pathname).toBe("/tasks/SOK-12-fix-login");
    expect(window.location.search).toBe("?tab=jobs");
    expect(window.location.hash).toBe("#comment-3");
  });

  it("keeps a UUID URL so bookmarks stay workspace-safe", () => {
    open(`/tasks/${UUID}?tab=jobs#comment-3`);

    render(<TaskCanonicalUrl href="/tasks/SOK-12-fix-login" />);

    expect(replaceState).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe(`/tasks/${UUID}`);
    expect(window.location.search).toBe("?tab=jobs");
    expect(window.location.hash).toBe("#comment-3");
  });

  it("does nothing when the URL is already canonical", () => {
    open("/tasks/SOK-12-fix-login");

    render(<TaskCanonicalUrl href="/tasks/SOK-12-fix-login" />);

    expect(replaceState).not.toHaveBeenCalled();
  });

  it("leaves sub-routes such as the edit modal alone", () => {
    open(`/tasks/${UUID}/edit`);

    render(<TaskCanonicalUrl href="/tasks/SOK-12-fix-login" />);

    expect(replaceState).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe(`/tasks/${UUID}/edit`);
  });
});
