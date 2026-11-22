import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  registerStudioWorkspaceBrief,
  takeStudioBriefFor,
} from "@/app/projects/components/image-studio/studio-workspace-brief";

import { useImageStudioWorkspaceBrief } from "./use-image-studio-workspace-brief";

vi.mock(
  "@/app/projects/components/image-studio/studio-workspace-brief",
  () => ({
    registerStudioWorkspaceBrief: vi.fn(),
    takeStudioBriefFor: vi.fn(),
  }),
);

describe("useImageStudioWorkspaceBrief", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("registers a live prompt getter on All-projects mount and unregisters on unmount", () => {
    const unregister = vi.fn();
    let readLatestPrompt: (() => string) | undefined;
    vi.mocked(registerStudioWorkspaceBrief).mockImplementation((getter) => {
      readLatestPrompt = getter;
      return unregister;
    });
    vi.mocked(takeStudioBriefFor).mockReturnValue(null);

    const { result, unmount } = renderHook(() =>
      useImageStudioWorkspaceBrief(null),
    );
    expect(takeStudioBriefFor).toHaveBeenCalledWith(null);
    expect(registerStudioWorkspaceBrief).toHaveBeenCalledTimes(1);
    expect(readLatestPrompt?.()).toBe("");

    act(() => {
      result.current[1]("Summer launch hero");
    });
    expect(result.current[0]).toBe("Summer launch hero");
    expect(readLatestPrompt?.()).toBe("Summer launch hero");

    unmount();
    expect(unregister).toHaveBeenCalledTimes(1);
  });

  it("restores a carried brief when mounting for a project without registering", () => {
    vi.mocked(takeStudioBriefFor).mockReturnValue("Carried brief");

    const { result, unmount } = renderHook(() =>
      useImageStudioWorkspaceBrief("proj-1"),
    );

    expect(takeStudioBriefFor).toHaveBeenCalledWith("proj-1");
    expect(result.current[0]).toBe("Carried brief");
    expect(registerStudioWorkspaceBrief).not.toHaveBeenCalled();

    unmount();
  });
});
