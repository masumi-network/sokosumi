"use client";

import { type RefObject, useEffect, useRef } from "react";

export interface DictationRecording {
  recorder: MediaRecorder;
  stream: MediaStream;
  timer: ReturnType<typeof setInterval>;
  keep: boolean;
}

export function stopDictationStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

/**
 * Tracks whether `DictationButton` is unmounted (or hidden under React
 * `<Activity>`) and discards any in-progress recording, timer, and media
 * stream on cleanup.
 */
export function useDictationUnmountCleanup(
  recordingRef: RefObject<DictationRecording | null>,
): RefObject<boolean> {
  const unmountedRef = useRef(false);

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      const recording = recordingRef.current;
      if (!recording) return;
      recordingRef.current = null;
      recording.keep = false;
      clearInterval(recording.timer);
      if (recording.recorder.state !== "inactive") recording.recorder.stop();
      stopDictationStream(recording.stream);
    };
  }, []);

  return unmountedRef;
}
