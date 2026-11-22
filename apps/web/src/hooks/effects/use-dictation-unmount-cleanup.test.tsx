import { render } from "@testing-library/react";
import { Activity, type RefObject, StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  type DictationRecording,
  useDictationUnmountCleanup,
} from "./use-dictation-unmount-cleanup";

function makeRecording() {
  const trackStop = vi.fn();
  const recorderStop = vi.fn();
  const timer = setInterval(() => {}, 1_000);
  const recording: DictationRecording = {
    recorder: {
      state: "recording",
      stop: recorderStop,
    } as unknown as MediaRecorder,
    stream: {
      getTracks: () => [{ stop: trackStop }],
    } as unknown as MediaStream,
    timer,
    keep: true,
  };
  return { recording, trackStop, recorderStop };
}

describe("useDictationUnmountCleanup", () => {
  it("keeps unmountedRef false while mounted and stops active recording on unmount", () => {
    const recordingRef: RefObject<DictationRecording | null> = {
      current: null,
    };
    const captured: { unmountedRef: RefObject<boolean> | null } = {
      unmountedRef: null,
    };

    function Probe() {
      captured.unmountedRef = useDictationUnmountCleanup(recordingRef);
      return null;
    }

    const { unmount } = render(<Probe />);
    expect(captured.unmountedRef?.current).toBe(false);

    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
    const { recording, trackStop, recorderStop } = makeRecording();
    recordingRef.current = recording;

    unmount();
    expect(captured.unmountedRef?.current).toBe(true);
    expect(recordingRef.current).toBeNull();
    expect(recording.keep).toBe(false);
    expect(clearIntervalSpy).toHaveBeenCalledWith(recording.timer);
    expect(recorderStop).toHaveBeenCalledOnce();
    expect(trackStop).toHaveBeenCalledOnce();
    clearIntervalSpy.mockRestore();
  });

  it("does not stop an already-inactive MediaRecorder on unmount", () => {
    const recordingRef: RefObject<DictationRecording | null> = {
      current: null,
    };
    const { recording, trackStop, recorderStop } = makeRecording();
    (recording.recorder as unknown as { state: string }).state = "inactive";
    recordingRef.current = recording;

    function Probe() {
      useDictationUnmountCleanup(recordingRef);
      return null;
    }

    const { unmount } = render(<Probe />);
    unmount();
    expect(recorderStop).not.toHaveBeenCalled();
    expect(trackStop).toHaveBeenCalledOnce();
  });

  it("resets unmountedRef on StrictMode replay and Activity reveal, and stops active recording on Activity hide", () => {
    const recordingRef: RefObject<DictationRecording | null> = {
      current: null,
    };
    const captured: { unmountedRef: RefObject<boolean> | null } = {
      unmountedRef: null,
    };

    function Probe() {
      captured.unmountedRef = useDictationUnmountCleanup(recordingRef);
      return null;
    }

    const { rerender, unmount } = render(
      <StrictMode>
        <Activity mode="visible">
          <Probe />
        </Activity>
      </StrictMode>,
    );
    expect(captured.unmountedRef?.current).toBe(false);

    const { recording, trackStop, recorderStop } = makeRecording();
    recordingRef.current = recording;

    rerender(
      <StrictMode>
        <Activity mode="hidden">
          <Probe />
        </Activity>
      </StrictMode>,
    );
    expect(captured.unmountedRef?.current).toBe(true);
    expect(recordingRef.current).toBeNull();
    expect(recording.keep).toBe(false);
    expect(recorderStop).toHaveBeenCalledOnce();
    expect(trackStop).toHaveBeenCalledOnce();

    rerender(
      <StrictMode>
        <Activity mode="visible">
          <Probe />
        </Activity>
      </StrictMode>,
    );
    expect(captured.unmountedRef?.current).toBe(false);

    unmount();
    expect(captured.unmountedRef?.current).toBe(true);
  });
});
