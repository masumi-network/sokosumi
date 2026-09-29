import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let pathname = "/tasks/uuid";

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}));

import { TaskCanonicalUrl } from "./task-canonical-url";

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

  it("replaces the URL with the canonical one, keeping search and hash", () => {
    open("/tasks/uuid?tab=jobs#comment-3");

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

  it("does nothing when the URL is already canonical", () => {
    open("/tasks/SOK-12-fix-login");

    render(<TaskCanonicalUrl href="/tasks/SOK-12-fix-login" />);

    expect(replaceState).not.toHaveBeenCalled();
  });

  it("leaves sub-routes such as the edit modal alone", () => {
    open("/tasks/uuid/edit");

    render(<TaskCanonicalUrl href="/tasks/SOK-12-fix-login" />);

    expect(replaceState).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe("/tasks/uuid/edit");
  });
});
