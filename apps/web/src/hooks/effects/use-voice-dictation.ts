"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useAbortController } from "./use-abort-controller";
import { useLatestRef } from "./use-latest-ref";

/** Dictation stops and turns into text on its own after two minutes. */
export const DICTATION_MAX_MS = 120_000;

/**
 * MP4 (AAC or Opus) first: Safari and recent Chrome record it. WebM/Opus is
 * the fallback (Firefox, older Chrome). Core transcribes both.
 */
const VOICE_FORMATS = [
  { mimeType: "audio/mp4", extension: "m4a" },
  { mimeType: "audio/webm", extension: "weba" },
] as const;

export function pickVoiceFormat() {
  if (
    typeof MediaRecorder === "undefined" ||
    !navigator.mediaDevices?.getUserMedia
  ) {
    return null;
  }
  return (
    VOICE_FORMATS.find((format) =>
      MediaRecorder.isTypeSupported(format.mimeType),
    ) ?? null
  );
}

function stopStream(stream: MediaStream) {
  for (const track of stream.getTracks()) track.stop();
}

interface Recording {
  recorder: MediaRecorder;
  stream: MediaStream;
  timer: ReturnType<typeof setInterval>;
  keep: boolean;
}

interface UseVoiceDictationOptions {
  onRecorded: (file: File) => void;
  onRecordingChange?: (recording: boolean) => void;
  onBlocked?: () => void;
  onError?: () => void;
}

export interface VoiceDictationState {
  starting: boolean;
  elapsedMs: number | null;
  start: () => Promise<void>;
  finish: (keep: boolean) => void;
}

/**
 * Owns browser `MediaRecorder`, `MediaStream`, elapsed timer, and automatic
 * microphone teardown when unmounted during permission or active recording.
 */
export function useVoiceDictation({
  onRecorded,
  onRecordingChange,
  onBlocked,
  onError,
}: UseVoiceDictationOptions): VoiceDictationState {
  const callbacksRef = useLatestRef({
    onRecorded,
    onRecordingChange,
    onBlocked,
    onError,
  });
  const recordingRef = useRef<Recording | null>(null);
  const startingRef = useRef(false);
  const permissionAbort = useAbortController();
  const [starting, setStarting] = useState(false);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);

  const stopRecording = useCallback((keep: boolean): boolean => {
    const recording = recordingRef.current;
    if (!recording) return false;
    recordingRef.current = null;
    recording.keep = keep;
    clearInterval(recording.timer);
    if (recording.recorder.state !== "inactive") recording.recorder.stop();
    stopStream(recording.stream);
    return true;
  }, []);

  const finish = useCallback(
    (keep: boolean) => {
      if (!stopRecording(keep)) return;
      setElapsedMs(null);
      callbacksRef.current.onRecordingChange?.(false);
    },
    [callbacksRef, stopRecording],
  );

  useEffect(() => {
    return () => {
      stopRecording(false);
    };
  }, [stopRecording]);

  const start = useCallback(async () => {
    const format = pickVoiceFormat();
    if (!format || startingRef.current || recordingRef.current) return;
    startingRef.current = true;
    setStarting(true);
    const attempt = permissionAbort.start();
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      permissionAbort.release(attempt);
      startingRef.current = false;
      setStarting(false);
      if (!attempt.signal.aborted) {
        callbacksRef.current.onBlocked?.();
      }
      return;
    }
    permissionAbort.release(attempt);
    startingRef.current = false;
    setStarting(false);
    // Room switched or thread closed during the permission prompt.
    if (attempt.signal.aborted) {
      stopStream(stream);
      return;
    }

    const recorder = new MediaRecorder(stream, { mimeType: format.mimeType });
    const chunks: Blob[] = [];
    const startedAt = Date.now();
    const recording: Recording = {
      recorder,
      stream,
      keep: false,
      timer: setInterval(() => {
        const elapsed = Date.now() - startedAt;
        if (elapsed >= DICTATION_MAX_MS) finish(true);
        else setElapsedMs(elapsed);
      }, 250),
    };
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      if (!recording.keep || chunks.length === 0) return;
      callbacksRef.current.onRecorded(
        new File(
          [new Blob(chunks, { type: format.mimeType })],
          `dictation.${format.extension}`,
          { type: format.mimeType },
        ),
      );
    };
    recorder.onerror = () => {
      finish(false);
      callbacksRef.current.onError?.();
    };
    recordingRef.current = recording;
    recorder.start();
    setElapsedMs(0);
    callbacksRef.current.onRecordingChange?.(true);
  }, [callbacksRef, finish, permissionAbort]);

  return {
    starting,
    elapsedMs,
    start,
    finish,
  };
}
