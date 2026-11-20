import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cancel: vi.fn(),
  openProjectScope: vi.fn(),
  openScopeCreate: vi.fn(),
  resetScopeDialogs: vi.fn(),
  setScopeCreateOpen: vi.fn(),
}));

vi.mock("@/app/components/project-scope/sidebar-project-scope-state", () => ({
  openProjectScope: mocks.openProjectScope,
  openScopeCreate: mocks.openScopeCreate,
  resetScopeDialogs: mocks.resetScopeDialogs,
  setScopeCreateOpen: mocks.setScopeCreateOpen,
}));

import {
  useProjectScopePromptAction,
  useRequiredProjectScope,
  useResetScopeDialogsOnUnmount,
} from "./use-project-scope-dialogs";

describe("use-project-scope-dialogs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.openProjectScope.mockReturnValue(mocks.cancel);
  });

  it("resets scope dialogs only on unmount", () => {
    const { rerender, unmount } = renderHook(() =>
      useResetScopeDialogsOnUnmount(),
    );

    expect(mocks.resetScopeDialogs).not.toHaveBeenCalled();
    rerender();
    expect(mocks.resetScopeDialogs).not.toHaveBeenCalled();

    unmount();
    expect(mocks.resetScopeDialogs).toHaveBeenCalledOnce();
  });

  it("opens required project scope on mount and cancels on unmount", () => {
    const onSelect = vi.fn();
    const { rerender, unmount } = renderHook(
      ({ reason }) => useRequiredProjectScope({ reason, onSelect }),
      { initialProps: { reason: "Pick a project." } },
    );

    expect(mocks.openProjectScope).toHaveBeenCalledExactlyOnceWith({
      required: true,
      reason: "Pick a project.",
      onSelect,
    });
    expect(mocks.cancel).not.toHaveBeenCalled();

    // Rerendering must not reopen or cancel while still mounted.
    rerender({ reason: "Pick another." });
    expect(mocks.openProjectScope).toHaveBeenCalledOnce();
    expect(mocks.cancel).not.toHaveBeenCalled();

    unmount();
    expect(mocks.cancel).toHaveBeenCalledOnce();
  });

  it("cancels and closes create on unmount only after a prompt action opened scope", () => {
    const { unmount: unmountUnused } = renderHook(() =>
      useProjectScopePromptAction(),
    );
    unmountUnused();
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.setScopeCreateOpen).not.toHaveBeenCalled();

    const opener = document.createElement("button");
    const onSelect = vi.fn();
    const { result, unmount } = renderHook(() => useProjectScopePromptAction());

    act(() => {
      result.current(
        { reason: "Needs a project.", onSelect },
        { create: true, opener },
      );
    });

    expect(mocks.openProjectScope).toHaveBeenCalledExactlyOnceWith({
      required: true,
      reason: "Needs a project.",
      onSelect,
    });
    expect(mocks.openScopeCreate).toHaveBeenCalledExactlyOnceWith(opener);
    expect(mocks.cancel).not.toHaveBeenCalled();

    unmount();
    expect(mocks.cancel).toHaveBeenCalledOnce();
    expect(mocks.setScopeCreateOpen).toHaveBeenCalledExactlyOnceWith(false);
  });
});
