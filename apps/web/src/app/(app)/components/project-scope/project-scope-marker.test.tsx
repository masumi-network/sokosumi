import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pathname: { current: "/tasks/t1" },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname.current,
}));

import { ProjectScopeMarker, useMarkedProjectId } from "./project-scope-marker";

/** What a reader at `pathname` sees, as the chrome would read it. */
function Reader({ pathname }: { pathname: string }) {
  return <output data-testid={pathname}>{useMarkedProjectId(pathname)}</output>;
}

function read(container: HTMLElement, pathname: string) {
  const node = container.querySelector(`[data-testid="${pathname}"]`);
  if (!node) throw new Error(`No reader for ${pathname}`);
  return node.textContent;
}

beforeEach(() => {
  mocks.pathname.current = "/tasks/t1";
});

describe("ProjectScopeMarker", () => {
  it("renders nothing and names its page's project", () => {
    const { container } = render(
      <>
        <ProjectScopeMarker projectId="p1" />
        <Reader pathname="/tasks/t1" />
      </>,
    );

    expect(read(container, "/tasks/t1")).toBe("p1");
    expect(container.querySelectorAll("output")).toHaveLength(1);
  });

  it("keeps naming the project on the detail page's sub-routes", () => {
    const { container } = render(
      <>
        <ProjectScopeMarker projectId="p1" />
        <Reader pathname="/tasks/t1/edit" />
      </>,
    );

    expect(read(container, "/tasks/t1/edit")).toBe("p1");
  });

  it("is ignored on any other path", () => {
    const { container } = render(
      <>
        <ProjectScopeMarker projectId="p1" />
        <Reader pathname="/tasks/t2" />
        <Reader pathname="/tasks" />
        <Reader pathname="/schedules/t1" />
      </>,
    );

    expect(read(container, "/tasks/t2")).toBe("");
    expect(read(container, "/tasks")).toBe("");
    expect(read(container, "/schedules/t1")).toBe("");
  });

  it("publishes nothing when mounted off a detail page", () => {
    mocks.pathname.current = "/chat";
    const { container } = render(
      <>
        <ProjectScopeMarker projectId="p1" />
        <Reader pathname="/chat" />
      </>,
    );

    expect(read(container, "/chat")).toBe("");
  });

  it("clears on unmount", () => {
    const { container, rerender } = render(
      <>
        <ProjectScopeMarker projectId="p1" />
        <Reader pathname="/tasks/t1" />
      </>,
    );
    expect(read(container, "/tasks/t1")).toBe("p1");

    rerender(<Reader pathname="/tasks/t1" />);

    expect(read(container, "/tasks/t1")).toBe("");
  });

  it("follows a change of project", () => {
    const { container, rerender } = render(
      <>
        <ProjectScopeMarker projectId="p1" />
        <Reader pathname="/tasks/t1" />
      </>,
    );

    rerender(
      <>
        <ProjectScopeMarker projectId="p2" />
        <Reader pathname="/tasks/t1" />
      </>,
    );

    expect(read(container, "/tasks/t1")).toBe("p2");
  });

  it("keeps a newer page's project when the older marker unmounts", () => {
    const { container, rerender } = render(
      <>
        <ProjectScopeMarker key="old" projectId="p1" />
        <Reader pathname="/tasks/t1" />
      </>,
    );

    rerender(
      <>
        <ProjectScopeMarker key="old" projectId="p1" />
        <ProjectScopeMarker key="new" projectId="p2" />
        <Reader pathname="/tasks/t1" />
      </>,
    );
    rerender(
      <>
        <ProjectScopeMarker key="new" projectId="p2" />
        <Reader pathname="/tasks/t1" />
      </>,
    );

    expect(read(container, "/tasks/t1")).toBe("p2");
  });
});
