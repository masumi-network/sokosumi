"use client";

import { Mic, Square, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useRef } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  pickVoiceFormat,
  useVoiceDictation,
} from "@/hooks/effects/use-voice-dictation";
import useIsClient from "@/hooks/use-is-client";

export function formatVoiceElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

const focusOnMount = (node: HTMLButtonElement | null) => node?.focus();

interface DictationButtonProps {
  onRecorded: (file: File) => void;
  /** Tells the composer to hold Send while the mic is open. */
  onRecordingChange?: (recording: boolean) => void;
  disabled?: boolean;
  /** Spins the button while the caller works on the last recording. */
  loading?: boolean;
  buttonClassName?: string;
}

/**
 * Mic beside Send, like ChatGPT's. Records with the browser's MediaRecorder
 * and hands the result to the caller as a File, which turns it into text.
 * Hidden where the browser cannot record.
 */
export function DictationButton({
  onRecorded,
  onRecordingChange,
  disabled,
  loading,
  buttonClassName,
}: DictationButtonProps) {
  const t = useTranslations("App.Channels.Toolbar");
  const isClient = useIsClient();
  const containerRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef(false);

  const handleRecordingChange = useCallback(
    (recording: boolean) => {
      if (!recording) {
        returnFocusRef.current =
          containerRef.current?.contains(document.activeElement) ?? false;
      }
      onRecordingChange?.(recording);
    },
    [onRecordingChange],
  );

  const { starting, elapsedMs, start, finish } = useVoiceDictation({
    onRecorded,
    onRecordingChange: handleRecordingChange,
    onBlocked: () => toast.error(t("dictationBlocked")),
    onError: () => toast.error(t("voiceFailed")),
  });

  // Stable so React calls it only when the mic button mounts.
  const micRef = useCallback((node: HTMLButtonElement | null) => {
    if (node && returnFocusRef.current) {
      returnFocusRef.current = false;
      node.focus();
    }
  }, []);

  if (!isClient || !pickVoiceFormat()) return null;

  if (elapsedMs === null) {
    return (
      <Button
        ref={micRef}
        type="button"
        variant="ghost"
        size="icon"
        className={buttonClassName}
        title={t("dictate")}
        aria-label={t("dictate")}
        disabled={disabled || starting}
        loading={loading}
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
        aria-label={t("dictating")}
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
        title={t("cancelDictation")}
        aria-label={t("cancelDictation")}
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
        title={t("stopDictation")}
        aria-label={t("stopDictation")}
        onClick={() => finish(true)}
      >
        <Square className="size-4 fill-current" aria-hidden />
      </Button>
    </div>
  );
}
