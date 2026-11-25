"use client";

import { useTranslations } from "next-intl";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { toast } from "sonner";

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

interface UseDictationRecorderOptions {
  onRecorded: (file: File) => void;
  /** Tells the composer to hold Send while the mic is open. */
  onRecordingChange?: (recording: boolean) => void;
}

/**
 * Owns the browser `MediaRecorder` dictation lifecycle (`start`, `finish`,
 * elapsed timer, and unmount cleanup) for `DictationButton`.
 */
export function useDictationRecorder({
  onRecorded,
  onRecordingChange,
}: UseDictationRecorderOptions) {
  const t = useTranslations("App.Channels.Toolbar");
  const recordingRef = useRef<Recording | null>(null);
  const startingRef = useRef(false);
  const unmountedRef = useRef(false);
  const [starting, setStarting] = useState(false);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);

  function finish(keep: boolean) {
    const recording = recordingRef.current;
    if (!recording) return;
    recordingRef.current = null;
    recording.keep = keep;
    clearInterval(recording.timer);
    if (recording.recorder.state !== "inactive") recording.recorder.stop();
    stopStream(recording.stream);
    setElapsedMs(null);
    onRecordingChange?.(false);
  }

  const stopOnCleanup = useEffectEvent(() => {
    finish(false);
  });

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      stopOnCleanup();
    };
  }, []);

  async function start() {
    const format = pickVoiceFormat();
    if (!format || startingRef.current || recordingRef.current) return;
    startingRef.current = true;
    setStarting(true);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      startingRef.current = false;
      setStarting(false);
      if (!unmountedRef.current) {
        toast.error(t("dictationBlocked"));
      }
      return;
    }
    startingRef.current = false;
    setStarting(false);
    // Room switched or thread closed during the permission prompt.
    if (unmountedRef.current) {
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
      onRecorded(
        new File(
          [new Blob(chunks, { type: format.mimeType })],
          `dictation.${format.extension}`,
          { type: format.mimeType },
        ),
      );
    };
    recorder.onerror = () => {
      finish(false);
      toast.error(t("voiceFailed"));
    };
    recordingRef.current = recording;
    recorder.start();
    setElapsedMs(0);
    onRecordingChange?.(true);
  }

  return { start, finish, starting, elapsedMs };
}
