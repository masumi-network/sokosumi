import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  pathname: { current: "/tasks" },
  search: { current: new URLSearchParams() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
  usePathname: () => mocks.pathname.current,
  useSearchParams: () => mocks.search.current,
}));

import { ProjectScopeMarker } from "./project-scope-marker";
import { returnFocusTo, useProjectScopeSwitch } from "./use-project-scope";

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

    current().select("p-1");

    expect(mocks.push).toHaveBeenCalledWith("/tasks?projectId=p-1");
  });

  it("stays put when the chosen scope is the one in hand", () => {
    mocks.search.current = new URLSearchParams("projectId=p-1&status=done");
    const current = renderSwitch();

    current().select("p-1");

    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("pushes the workspace href for null on a project page", () => {
    mocks.pathname.current = "/projects/p-1/files";
    const current = renderSwitch();

    current().select(null);

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

    current().select("p-2");
    expect(mocks.push).toHaveBeenLastCalledWith("/tasks?projectId=p-2");
    current().select(null);
    expect(mocks.push).toHaveBeenLastCalledWith("/tasks");
  });

  it("reads a schedule's project and goes to the schedule list", () => {
    mocks.pathname.current = "/schedules/s-1";
    const current = renderSwitch(<ProjectScopeMarker projectId="p-1" />);

    expect(current().projectId).toBe("p-1");
    current().select(null);
    expect(mocks.push).toHaveBeenLastCalledWith("/schedules");
  });

  it("is the workspace for an item with no project", () => {
    mocks.pathname.current = "/tasks/t-1";
    const current = renderSwitch(<ProjectScopeMarker projectId={null} />);

    expect(current().projectId).toBeNull();
  });
});
