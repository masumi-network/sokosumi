import { render } from "@testing-library/react";
import { Activity } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { resetScopeDialogsMock } = vi.hoisted(() => ({
  resetScopeDialogsMock: vi.fn(),
}));

vi.mock("@/app/components/project-scope/sidebar-project-scope-state", () => ({
  resetScopeDialogs: (...args: unknown[]) => resetScopeDialogsMock(...args),
}));

import { useSidebarScopeMobileReset } from "./use-sidebar-scope-mobile-reset";

function ResetProbe() {
  useSidebarScopeMobileReset();
  return null;
}

describe("useSidebarScopeMobileReset", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("resets scope dialogs on hide and unmount, not on mount", () => {
    const { rerender, unmount } = render(
      <Activity mode="visible">
        <ResetProbe />
      </Activity>,
    );

    expect(resetScopeDialogsMock).not.toHaveBeenCalled();

    rerender(
      <Activity mode="hidden">
        <ResetProbe />
      </Activity>,
    );
    expect(resetScopeDialogsMock).toHaveBeenCalledTimes(1);

    rerender(
      <Activity mode="visible">
        <ResetProbe />
      </Activity>,
    );
    expect(resetScopeDialogsMock).toHaveBeenCalledTimes(1);

    unmount();
    expect(resetScopeDialogsMock).toHaveBeenCalledTimes(2);
  });
});
