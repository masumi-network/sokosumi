import { render } from "@testing-library/react";
import { Activity, type RefObject } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { setScopeCreateOpenMock } = vi.hoisted(() => ({
  setScopeCreateOpenMock: vi.fn(),
}));

vi.mock("@/app/components/project-scope/sidebar-project-scope-state", () => ({
  setScopeCreateOpen: (...args: unknown[]) => setScopeCreateOpenMock(...args),
}));

import { useProjectScopeRequiredCleanup } from "./use-project-scope-required-cleanup";

function CleanupProbe({
  cancelRequest,
}: {
  cancelRequest: RefObject<(() => void) | null>;
}) {
  useProjectScopeRequiredCleanup(cancelRequest);
  return null;
}

describe("useProjectScopeRequiredCleanup", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("cancels the active request and closes create modal on hide/unmount, and no-ops when ref is null", () => {
    const cancel = vi.fn();
    const cancelRequest: RefObject<(() => void) | null> = { current: cancel };

    const { rerender, unmount } = render(
      <Activity mode="visible">
        <CleanupProbe cancelRequest={cancelRequest} />
      </Activity>,
    );

    expect(cancel).not.toHaveBeenCalled();
    expect(setScopeCreateOpenMock).not.toHaveBeenCalled();

    rerender(
      <Activity mode="hidden">
        <CleanupProbe cancelRequest={cancelRequest} />
      </Activity>,
    );
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(setScopeCreateOpenMock).toHaveBeenCalledTimes(1);
    expect(setScopeCreateOpenMock).toHaveBeenCalledWith(false);

    cancelRequest.current = null;
    rerender(
      <Activity mode="visible">
        <CleanupProbe cancelRequest={cancelRequest} />
      </Activity>,
    );
    unmount();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(setScopeCreateOpenMock).toHaveBeenCalledTimes(1);
  });
});
