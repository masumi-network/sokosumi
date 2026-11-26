import { render } from "@testing-library/react";
import { Activity } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { openProjectScopeMock } = vi.hoisted(() => ({
  openProjectScopeMock: vi.fn(),
}));

vi.mock("@/app/components/project-scope/sidebar-project-scope-state", () => ({
  openProjectScope: (...args: unknown[]) => openProjectScopeMock(...args),
}));

import { useRequireProjectScope } from "./use-require-project-scope";

function RequireScopeProbe({ reason }: { reason: string }) {
  useRequireProjectScope({ reason });
  return null;
}

describe("useRequireProjectScope", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("opens required project scope on mount/reveal and invokes its cleanup on hide/unmount", () => {
    const cancelFirst = vi.fn();
    const cancelSecond = vi.fn();
    openProjectScopeMock
      .mockReturnValueOnce(cancelFirst)
      .mockReturnValueOnce(cancelSecond);

    const { rerender, unmount } = render(
      <Activity mode="visible">
        <RequireScopeProbe reason="Pick a project" />
      </Activity>,
    );

    expect(openProjectScopeMock).toHaveBeenCalledTimes(1);
    expect(openProjectScopeMock).toHaveBeenCalledWith({
      reason: "Pick a project",
      required: true,
    });
    expect(cancelFirst).not.toHaveBeenCalled();

    rerender(
      <Activity mode="hidden">
        <RequireScopeProbe reason="Pick a project" />
      </Activity>,
    );
    expect(cancelFirst).toHaveBeenCalledTimes(1);

    rerender(
      <Activity mode="visible">
        <RequireScopeProbe reason="Pick a project" />
      </Activity>,
    );
    expect(openProjectScopeMock).toHaveBeenCalledTimes(2);

    unmount();
    expect(cancelSecond).toHaveBeenCalledTimes(1);
  });
});
