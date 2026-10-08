import { act, render, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userId: "user-1",
  organizationId: "org-1",
  push: vi.fn(),
  pathname: { current: "/tasks" },
  search: { current: new URLSearchParams() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
  usePathname: () => mocks.pathname.current,
  useSearchParams: () => mocks.search.current,
}));

vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({
    data: {
      user: { id: mocks.userId },
      session: { activeOrganizationId: mocks.organizationId },
    },
    isPending: false,
    error: null,
  }),
}));

import { ProjectScopeMarker } from "./project-scope-marker";
import {
  returnFocusTo,
  useProjectScope,
  useProjectScopeSwitch,
} from "./use-project-scope";

function renderSwitch(page: ReactNode = null) {
  const latest: { current: ReturnType<typeof useProjectScopeSwitch> | null } = {
    current: null,
  };
  function Harness() {
    const scope = useProjectScopeSwitch();
    latest.current = scope;
    return null;
  }
  render(
    <>
      {page}
      <Harness />
    </>,
  );
  return () => {
    if (!latest.current) throw new Error("Hook never rendered");
    return latest.current;
  };
}

function closeEvent() {
  return new Event("focusout", { cancelable: true });
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  mocks.userId = "user-1";
  mocks.organizationId = "org-1";
  mocks.pathname.current = "/tasks";
  mocks.search.current = new URLSearchParams();
  document.body.innerHTML = "";
});

describe("returnFocusTo", () => {
  it("prevents the default focus and focuses a connected opener", () => {
    const opener = document.createElement("button");
    const other = document.createElement("button");
    document.body.append(opener, other);
    other.focus();
    const event = closeEvent();

    returnFocusTo(opener)(event);

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(opener);
  });

  it("does nothing without an opener", () => {
    const event = closeEvent();

    returnFocusTo(null)(event);

    expect(event.defaultPrevented).toBe(false);
  });

  it("falls back to the header's first visible control for a gone opener", () => {
    const opener = document.createElement("button");
    const header = document.createElement("header");
    const back = document.createElement("a");
    back.href = "/chat";
    header.append(back);
    document.body.append(header);
    const event = closeEvent();

    returnFocusTo(opener)(event);

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(back);
  });

  it("falls back for an opener a chat room hides", () => {
    const opener = document.createElement("button");
    const header = document.createElement("header");
    const toggle = document.createElement("button");
    header.append(toggle);
    document.body.append(opener, header);
    // happy-dom lays nothing out, so every element reports one rect.
    vi.spyOn(opener, "getClientRects").mockReturnValue({
      length: 0,
    } as unknown as DOMRectList);
    const event = closeEvent();

    returnFocusTo(opener)(event);

    expect(document.activeElement).toBe(toggle);
  });

  it("leaves focus to Radix when neither opener nor header can take it", () => {
    const opener = document.createElement("button");
    const focus = vi.spyOn(opener, "focus");
    const event = closeEvent();

    returnFocusTo(opener)(event);

    expect(event.defaultPrevented).toBe(false);
    expect(focus).not.toHaveBeenCalled();
  });
});

describe("useProjectScopeSwitch", () => {
  it("pushes the switch href for a chosen project", () => {
    const current = renderSwitch();

    act(() => current().select("p-1"));

    expect(mocks.push).toHaveBeenCalledWith("/tasks?projectId=p-1");
  });

  it("stays put when the chosen scope is the one in hand", () => {
    mocks.search.current = new URLSearchParams("projectId=p-1&status=done");
    const current = renderSwitch();

    act(() => current().select("p-1"));

    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("pushes the workspace href for null on a project page", () => {
    mocks.pathname.current = "/projects/p-1/files";
    const current = renderSwitch();

    act(() => current().select(null));

    expect(mocks.push).toHaveBeenCalledWith("/projects");
  });
});

describe("useProjectScope on a detail page", () => {
  it("reads the task's project from its marker", () => {
    mocks.pathname.current = "/tasks/t-1";
    const current = renderSwitch(<ProjectScopeMarker projectId="p-1" />);

    expect(current().projectId).toBe("p-1");
    // The sidebar's links carry it.
    expect(current().hrefFor("/drive")).toBe("/drive?view=tasks&projectId=p-1");
    expect(current().hrefFor("/agents")).toBe("/agents");
  });

  it("goes to the task list on a switch", () => {
    mocks.pathname.current = "/tasks/t-1";
    const current = renderSwitch(<ProjectScopeMarker projectId="p-1" />);

    act(() => current().select("p-2"));
    expect(mocks.push).toHaveBeenLastCalledWith("/tasks?projectId=p-2");
    act(() => current().select(null));
    expect(mocks.push).toHaveBeenLastCalledWith("/tasks");
  });

  it("reads a schedule's project and goes to the schedule list", () => {
    mocks.pathname.current = "/schedules/s-1";
    const current = renderSwitch(<ProjectScopeMarker projectId="p-1" />);

    expect(current().projectId).toBe("p-1");
    act(() => current().select(null));
    expect(mocks.push).toHaveBeenLastCalledWith("/schedules");
  });

  it("is the workspace for an item with no project", () => {
    mocks.pathname.current = "/tasks/t-1";
    const current = renderSwitch(<ProjectScopeMarker projectId={null} />);

    expect(current().projectId).toBeNull();
  });
});

describe("project scope persistence", () => {
  it("uses the loaded task's project and retains it after its marker unmounts", () => {
    let marker: ReactNode = null;
    mocks.search.current = new URLSearchParams("projectId=p-board");
    const view = renderHook(() => useProjectScope(), {
      wrapper: ({ children }) => (
        <>
          {marker}
          {children}
        </>
      ),
    });
    mocks.pathname.current = "/tasks/t-new";
    mocks.search.current = new URLSearchParams();
    marker = <ProjectScopeMarker projectId="p-task" />;
    view.rerender();
    expect(view.result.current.projectId).toBe("p-task");
    marker = null;
    view.rerender();
    expect(view.result.current.projectId).toBe("p-task");
    mocks.pathname.current = "/agents";
    view.rerender();
    expect(view.result.current.hrefFor("/tasks")).toBe(
      "/tasks?projectId=p-task",
    );
  });

  it("clears the board project only when a loaded task explicitly has no project", () => {
    let marker: ReactNode = null;
    mocks.search.current = new URLSearchParams("projectId=p-board");
    const view = renderHook(() => useProjectScope(), {
      wrapper: ({ children }) => (
        <>
          {marker}
          {children}
        </>
      ),
    });
    mocks.pathname.current = "/tasks/t-new";
    mocks.search.current = new URLSearchParams();
    marker = <ProjectScopeMarker projectId={null} />;
    view.rerender();
    expect(view.result.current.projectId).toBeNull();
    mocks.pathname.current = "/agents";
    marker = null;
    view.rerender();
    expect(view.result.current.projectId).toBeNull();
  });

  it.each(["/tasks/t-new", "/tasks/t-1/edit"])(
    "keeps the board project while %s loads and after leaving it",
    (pathname) => {
      mocks.search.current = new URLSearchParams("projectId=p-1");
      const view = renderHook(() => useProjectScope());
      mocks.pathname.current = pathname;
      mocks.search.current = new URLSearchParams();
      view.rerender();
      expect(view.result.current.projectId).toBe("p-1");
      expect(view.result.current.hrefFor("/tasks")).toBe(
        "/tasks?projectId=p-1",
      );
      mocks.pathname.current = "/agents";
      view.rerender();
      expect(view.result.current.projectId).toBe("p-1");
    },
  );

  it("keeps the project and menu links after navigating to chat", () => {
    mocks.search.current = new URLSearchParams("projectId=p-1");
    const view = renderHook(() => useProjectScope());
    mocks.pathname.current = "/chat/room-1";
    mocks.search.current = new URLSearchParams();
    view.rerender();
    expect(view.result.current.projectId).toBe("p-1");
    expect(view.result.current.hrefFor("/tasks")).toBe("/tasks?projectId=p-1");
    expect(view.result.current.hrefFor("/drive")).toBe(
      "/drive?view=tasks&projectId=p-1",
    );
    view.unmount();
    const remounted = renderHook(() => useProjectScope());
    expect(remounted.result.current.projectId).toBe("p-1");
  });

  it("keeps Everything after explicitly clearing the scope", () => {
    mocks.search.current = new URLSearchParams("projectId=p-1");
    const view = renderHook(() => useProjectScope());
    mocks.search.current = new URLSearchParams();
    view.rerender();
    mocks.pathname.current = "/chat/room-1";
    view.rerender();
    expect(view.result.current.projectId).toBeNull();
    expect(view.result.current.hrefFor("/tasks")).toBe("/tasks");
  });

  it("can choose Everything while a chat is open", () => {
    mocks.search.current = new URLSearchParams("projectId=p-1");
    const view = renderHook(() => useProjectScopeSwitch());
    mocks.pathname.current = "/chat/room-1";
    mocks.search.current = new URLSearchParams();
    view.rerender();
    act(() => view.result.current.select(null));
    expect(view.result.current.projectId).toBeNull();
    expect(view.result.current.hrefFor("/tasks")).toBe("/tasks");
  });

  it("isolates the remembered selection by user and workspace", () => {
    mocks.search.current = new URLSearchParams("projectId=p-1");
    const view = renderHook(() => useProjectScope());
    mocks.pathname.current = "/chat/room-1";
    mocks.search.current = new URLSearchParams();
    mocks.organizationId = "org-2";
    view.rerender();
    expect(view.result.current.projectId).toBeNull();
    mocks.organizationId = "org-1";
    mocks.userId = "user-2";
    view.rerender();
    expect(view.result.current.projectId).toBeNull();
    mocks.userId = "user-1";
    view.rerender();
    expect(view.result.current.projectId).toBe("p-1");
  });

  it("does not overwrite workspace memory with a stale URL or guard cleanup", () => {
    mocks.organizationId = "org-2";
    const view = renderHook(() => useProjectScopeSwitch());
    act(() => view.result.current.select("p-2"));
    mocks.search.current = new URLSearchParams("projectId=p-2");
    view.rerender();
    mocks.organizationId = "org-1";
    view.rerender();
    act(() => view.result.current.select("p-1"));
    mocks.search.current = new URLSearchParams("projectId=p-1");
    view.rerender();
    mocks.organizationId = "org-2";
    view.rerender();
    // The existing guard removes the previous workspace's inaccessible URL scope.
    mocks.search.current = new URLSearchParams();
    view.rerender();
    mocks.pathname.current = "/chat/room-1";
    view.rerender();
    expect(view.result.current.projectId).toBe("p-2");
  });

  it("remembers a new project query on the same page after switching workspace", () => {
    mocks.search.current = new URLSearchParams("projectId=p-1");
    const view = renderHook(() => useProjectScope());
    mocks.organizationId = "org-2";
    view.rerender();
    mocks.search.current = new URLSearchParams();
    view.rerender();
    mocks.search.current = new URLSearchParams("projectId=p-new");
    view.rerender();
    mocks.pathname.current = "/chat";
    mocks.search.current = new URLSearchParams();
    view.rerender();
    expect(view.result.current.projectId).toBe("p-new");
  });

  it("lets an explicit route replace the remembered project", () => {
    mocks.search.current = new URLSearchParams("projectId=p-1");
    const view = renderHook(() => useProjectScope());
    mocks.pathname.current = "/projects/p-2/files";
    mocks.search.current = new URLSearchParams();
    view.rerender();
    expect(view.result.current.projectId).toBe("p-2");
    mocks.pathname.current = "/chat";
    view.rerender();
    expect(view.result.current.projectId).toBe("p-2");
  });
});
