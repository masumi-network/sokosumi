import { renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  rememberFollowAfterSetup,
  type TaskFollowArm,
  useResumeTaskFollowAfterSetup,
} from "./use-resume-task-follow-after-setup";

describe("useResumeTaskFollowAfterSetup", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("consumes the stored task and auto-follows once under StrictMode", () => {
    rememberFollowAfterSetup("task-1");
    const onClearMarker = vi.fn();
    const onAutoFollow = vi.fn();

    renderHook(
      () =>
        useResumeTaskFollowAfterSetup({
          taskId: "task-1",
          arm: "add",
          active: true,
          onClearMarker,
          onAutoFollow,
        }),
      { wrapper: StrictMode },
    );

    expect(onClearMarker).toHaveBeenCalled();
    expect(onAutoFollow).toHaveBeenCalledTimes(1);
  });

  it("keeps the hand-off while arm is setup and resumes once arm becomes add", () => {
    rememberFollowAfterSetup("task-1");
    const onClearMarker = vi.fn();
    const onAutoFollow = vi.fn();

    const { rerender } = renderHook(
      ({ arm }: { arm: TaskFollowArm }) =>
        useResumeTaskFollowAfterSetup({
          taskId: "task-1",
          arm,
          active: true,
          onClearMarker,
          onAutoFollow,
        }),
      { initialProps: { arm: "setup" as TaskFollowArm } },
    );

    expect(onClearMarker).not.toHaveBeenCalled();
    expect(onAutoFollow).not.toHaveBeenCalled();

    rerender({ arm: "add" });

    expect(onClearMarker).toHaveBeenCalledTimes(1);
    expect(onAutoFollow).toHaveBeenCalledTimes(1);
  });

  it("clears the marker without auto-following for a mismatched task", () => {
    rememberFollowAfterSetup("task-other");
    const onClearMarker = vi.fn();
    const onAutoFollow = vi.fn();

    renderHook(() =>
      useResumeTaskFollowAfterSetup({
        taskId: "task-1",
        arm: "add",
        active: true,
        onClearMarker,
        onAutoFollow,
      }),
    );

    expect(onClearMarker).toHaveBeenCalledTimes(1);
    expect(onAutoFollow).not.toHaveBeenCalled();
  });
});
