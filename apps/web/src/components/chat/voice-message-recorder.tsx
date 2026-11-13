"use client";

import { Mic, Square, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import useIsClient from "@/hooks/use-is-client";
import { useMountEffect } from "@/hooks/use-mount-effect";

/** Recording stops and attaches on its own after two minutes. */
export const VOICE_MESSAGE_MAX_MS = 120_000;

/**
 * Safari records MP4/AAC, Chrome and Firefox WebM/Opus. Both are on the upload
 * allowlist. WebM gets `.weba` so chips classify it as audio, not video.
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

interface Recording {
  recorder: MediaRecorder;
  stream: MediaStream;
  timer: ReturnType<typeof setInterval>;
  keep: boolean;
}

interface VoiceMessageRecorderProps {
  onRecorded: (file: File) => void;
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
  disabled,
  buttonClassName,
}: VoiceMessageRecorderProps) {
  const t = useTranslations("App.Channels.Toolbar");
  const isClient = useIsClient();
  const recordingRef = useRef<Recording | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);

  function finish(keep: boolean) {
    const recording = recordingRef.current;
    if (!recording) return;
    recording.keep = keep;
    clearInterval(recording.timer);
    if (recording.recorder.state !== "inactive") recording.recorder.stop();
    for (const track of recording.stream.getTracks()) track.stop();
    recordingRef.current = null;
    setElapsedMs(null);
  }

  useMountEffect(() => () => finish(false));

  async function start() {
    const format = pickVoiceFormat();
    if (!format || recordingRef.current) return;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast.error(t("voiceBlocked"));
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
        if (elapsed >= VOICE_MESSAGE_MAX_MS) finish(true);
        else setElapsedMs(elapsed);
      }, 250),
    };
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      if (!recording.keep || chunks.length === 0) return;
      const at = new Date(startedAt);
      const pad = (value: number) => String(value).padStart(2, "0");
      // Local time; ":" is not allowed in file names on Windows.
      const stamp = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}.${pad(at.getMinutes())}`;
      onRecorded(
        new File(
          [new Blob(chunks, { type: format.mimeType })],
          `${t("voiceFileName", { time: stamp })}.${format.extension}`,
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
  }

  if (!isClient || !pickVoiceFormat()) return null;

  if (elapsedMs === null) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={buttonClassName}
        title={t("recordVoice")}
        aria-label={t("recordVoice")}
        disabled={disabled}
        onClick={() => void start()}
      >
        <Mic className="size-4" aria-hidden />
      </Button>
    );
  }

  return (
    <div className="flex shrink-0 items-center gap-1">
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
