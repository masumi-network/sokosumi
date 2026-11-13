"use client";

import { Mic, Square, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import useIsClient from "@/hooks/use-is-client";
import { useMountEffect } from "@/hooks/use-mount-effect";

/** Recording stops and attaches on its own after two minutes. */
export const VOICE_MESSAGE_MAX_MS = 120_000;

/**
 * MP4 (AAC or Opus) first: Safari and recent Chrome record it. WebM/Opus is
 * the fallback (Firefox, older Chrome). Both are on the upload allowlist.
 * WebM gets `.weba` so chips classify it as audio, not video.
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

export function formatVoiceElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function voiceFileStamp(at: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  // Local time; ":" is not allowed in file names on Windows.
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}.${pad(at.getMinutes())}`;
}

function stopStream(stream: MediaStream) {
  for (const track of stream.getTracks()) track.stop();
}

const focusOnMount = (node: HTMLButtonElement | null) => node?.focus();

interface Recording {
  recorder: MediaRecorder;
  stream: MediaStream;
  timer: ReturnType<typeof setInterval>;
  keep: boolean;
}

interface VoiceMessageRecorderProps {
  onRecorded: (file: File) => void;
  /** Tells the composer to hold Send while the mic is open. */
  onRecordingChange?: (recording: boolean) => void;
  disabled?: boolean;
  buttonClassName?: string;
}

/**
 * Mic button for the room composer. Records with the browser's MediaRecorder
 * and hands the result to the caller as a File, which uploads it like any
 * other attachment. Hidden where the browser cannot record.
 */
export function VoiceMessageRecorder({
  onRecorded,
  onRecordingChange,
  disabled,
  buttonClassName,
}: VoiceMessageRecorderProps) {
  const t = useTranslations("App.Channels.Toolbar");
  const isClient = useIsClient();
  const recordingRef = useRef<Recording | null>(null);
  const startingRef = useRef(false);
  const unmountedRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef(false);
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
    if (unmountedRef.current) return;
    returnFocusRef.current =
      containerRef.current?.contains(document.activeElement) ?? false;
    setElapsedMs(null);
    onRecordingChange?.(false);
  }

  useMountEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      finish(false);
    };
  });

  // Stable so React calls it only when the mic button mounts.
  const micRef = useCallback((node: HTMLButtonElement | null) => {
    if (node && returnFocusRef.current) {
      returnFocusRef.current = false;
      node.focus();
    }
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
      if (!unmountedRef.current) {
        setStarting(false);
        toast.error(t("voiceBlocked"));
      }
      return;
    }
    startingRef.current = false;
    // Room switched or thread closed during the permission prompt.
    if (unmountedRef.current) {
      stopStream(stream);
      return;
    }
    setStarting(false);

    const recorder = new MediaRecorder(stream, { mimeType: format.mimeType });
    const chunks: Blob[] = [];
    const startedAt = Date.now();
    const recording: Recording = {
      recorder,
      stream,
      keep: false,
      timer: setInterval(() => {
        const elapsed = Date.now() - startedAt;
        if (elapsed >= VOICE_MESSAGE_MAX_MS) finish(true);
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
          `${t("voiceFileName", { time: voiceFileStamp(new Date(startedAt)) })}.${format.extension}`,
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

  if (!isClient || !pickVoiceFormat()) return null;

  if (elapsedMs === null) {
    return (
      <Button
        ref={micRef}
        type="button"
        variant="ghost"
        size="icon"
        className={buttonClassName}
        title={t("recordVoice")}
        aria-label={t("recordVoice")}
        disabled={disabled || starting}
        onClick={() => void start()}
      >
        <Mic className="size-4" aria-hidden />
      </Button>
    );
  }

  return (
    <div ref={containerRef} className="flex shrink-0 items-center gap-1">
      <span
        role="timer"
        aria-label={t("voiceRecording")}
        className="text-foreground flex items-center gap-1.5 px-1 text-sm tabular-nums"
      >
        <span
          className="bg-destructive size-2 animate-pulse rounded-full motion-reduce:animate-none"
          aria-hidden
        />
        {formatVoiceElapsed(elapsedMs)}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={buttonClassName}
        title={t("cancelVoice")}
        aria-label={t("cancelVoice")}
        onClick={() => finish(false)}
      >
        <X className="size-4" aria-hidden />
      </Button>
      <Button
        ref={focusOnMount}
        type="button"
        variant="ghost"
        size="icon"
        className={buttonClassName}
        title={t("stopVoice")}
        aria-label={t("stopVoice")}
        onClick={() => finish(true)}
      >
        <Square className="size-4 fill-current" aria-hidden />
      </Button>
    </div>
  );
}
