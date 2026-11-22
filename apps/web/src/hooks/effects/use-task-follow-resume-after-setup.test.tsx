import { render } from "@testing-library/react";
import { Activity, StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  FOLLOW_AFTER_SETUP_SESSION_KEY,
  rememberFollowAfterSetup,
  type TaskFollowArm,
  useTaskFollowResumeAfterSetup,
} from "./use-task-follow-resume-after-setup";

function ResumeProbe({
  arm,
  taskId,
  setFollowMarker,
  onFollow,
}: {
  arm: TaskFollowArm;
  taskId: string;
  setFollowMarker: (value: null) => void;
  onFollow: () => void;
}) {
  useTaskFollowResumeAfterSetup({ arm, taskId, setFollowMarker, onFollow });
  return null;
}

describe("useTaskFollowResumeAfterSetup", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("clears the marker and follows once when arm is add and sessionStorage matches taskId", () => {
    const setFollowMarker = vi.fn();
    const onFollow = vi.fn();
    rememberFollowAfterSetup("task-1");

    const { rerender, unmount } = render(
      <ResumeProbe
        arm="add"
        taskId="task-1"
        setFollowMarker={setFollowMarker}
        onFollow={onFollow}
      />,
    );

    expect(setFollowMarker).toHaveBeenCalledTimes(1);
    expect(setFollowMarker).toHaveBeenCalledWith(null);
    expect(onFollow).toHaveBeenCalledTimes(1);
    expect(
      window.sessionStorage.getItem(FOLLOW_AFTER_SETUP_SESSION_KEY),
    ).toBeNull();

    // Mount-only effect: rerendering without remounting does not re-run.
    rememberFollowAfterSetup("task-1");
    rerender(
      <ResumeProbe
        arm="add"
        taskId="task-1"
        setFollowMarker={setFollowMarker}
        onFollow={onFollow}
      />,
    );
    expect(setFollowMarker).toHaveBeenCalledTimes(1);
    expect(onFollow).toHaveBeenCalledTimes(1);

    unmount();
  });

  it("clears marker twice under StrictMode replay while following only once", () => {
    const setFollowMarker = vi.fn();
    const onFollow = vi.fn();
    rememberFollowAfterSetup("task-1");

    const { unmount } = render(
      <StrictMode>
        <ResumeProbe
          arm="add"
          taskId="task-1"
          setFollowMarker={setFollowMarker}
          onFollow={onFollow}
        />
      </StrictMode>,
    );

    expect(setFollowMarker).toHaveBeenCalledTimes(2);
    expect(setFollowMarker).toHaveBeenNthCalledWith(1, null);
    expect(setFollowMarker).toHaveBeenNthCalledWith(2, null);
    expect(onFollow).toHaveBeenCalledTimes(1);
    expect(
      window.sessionStorage.getItem(FOLLOW_AFTER_SETUP_SESSION_KEY),
    ).toBeNull();

    unmount();
  });

  it("clears marker and storage without following when arm is active or stored task does not match", () => {
    const setFollowMarker = vi.fn();
    const onFollow = vi.fn();
    rememberFollowAfterSetup("task-1");

    const { unmount } = render(
      <ResumeProbe
        arm="active"
        taskId="task-1"
        setFollowMarker={setFollowMarker}
        onFollow={onFollow}
      />,
    );
    expect(setFollowMarker).toHaveBeenCalledExactlyOnceWith(null);
    expect(onFollow).not.toHaveBeenCalled();
    expect(
      window.sessionStorage.getItem(FOLLOW_AFTER_SETUP_SESSION_KEY),
    ).toBeNull();
    unmount();

    setFollowMarker.mockClear();
    rememberFollowAfterSetup("task-2");
    render(
      <ResumeProbe
        arm="add"
        taskId="task-1"
        setFollowMarker={setFollowMarker}
        onFollow={onFollow}
      />,
    );
    expect(setFollowMarker).toHaveBeenCalledExactlyOnceWith(null);
    expect(onFollow).not.toHaveBeenCalled();
    expect(
      window.sessionStorage.getItem(FOLLOW_AFTER_SETUP_SESSION_KEY),
    ).toBeNull();
  });

  it("preserves marker and storage while arm is setup or null, and runs on keyed remount under StrictMode", () => {
    const setFollowMarker = vi.fn();
    const onFollow = vi.fn();
    rememberFollowAfterSetup("task-1");

    const { rerender, unmount } = render(
      <StrictMode>
        <ResumeProbe
          key="setup"
          arm="setup"
          taskId="task-1"
          setFollowMarker={setFollowMarker}
          onFollow={onFollow}
        />
      </StrictMode>,
    );
    expect(setFollowMarker).not.toHaveBeenCalled();
    expect(onFollow).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(FOLLOW_AFTER_SETUP_SESSION_KEY)).toBe(
      "task-1",
    );

    rerender(
      <StrictMode>
        <ResumeProbe
          key="add"
          arm="add"
          taskId="task-1"
          setFollowMarker={setFollowMarker}
          onFollow={onFollow}
        />
      </StrictMode>,
    );
    expect(setFollowMarker).toHaveBeenCalledTimes(2);
    expect(onFollow).toHaveBeenCalledTimes(1);
    expect(
      window.sessionStorage.getItem(FOLLOW_AFTER_SETUP_SESSION_KEY),
    ).toBeNull();

    unmount();
  });

  it("re-runs on Activity reveal", () => {
    const setFollowMarker = vi.fn();
    const onFollow = vi.fn();
    rememberFollowAfterSetup("task-1");

    const { rerender, unmount } = render(
      <Activity mode="visible">
        <ResumeProbe
          arm="add"
          taskId="task-1"
          setFollowMarker={setFollowMarker}
          onFollow={onFollow}
        />
      </Activity>,
    );
    expect(setFollowMarker).toHaveBeenCalledTimes(1);
    expect(onFollow).toHaveBeenCalledTimes(1);

    rerender(
      <Activity mode="hidden">
        <ResumeProbe
          arm="add"
          taskId="task-1"
          setFollowMarker={setFollowMarker}
          onFollow={onFollow}
        />
      </Activity>,
    );
    expect(setFollowMarker).toHaveBeenCalledTimes(1);

    rerender(
      <Activity mode="visible">
        <ResumeProbe
          arm="add"
          taskId="task-1"
          setFollowMarker={setFollowMarker}
          onFollow={onFollow}
        />
      </Activity>,
    );
    expect(setFollowMarker).toHaveBeenCalledTimes(2);
    expect(onFollow).toHaveBeenCalledTimes(1);

    unmount();
  });
});
