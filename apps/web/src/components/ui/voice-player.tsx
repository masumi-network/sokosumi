"use client";

import { Download, Pause, Play } from "lucide-react";
import { useTranslations } from "next-intl";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { stripForcedDownloadParam } from "@/lib/utils/file-preview";
import { readAtMost, voiceWaveformPeaks } from "@/lib/utils/voice-message";

const WAVEFORM_BARS = 40;
/** Recorded voice is at most two minutes (about 1 MB); bigger audio keeps the plain track. */
const WAVEFORM_MAX_BYTES = 3 * 1024 * 1024;
const WAVEFORM_MAX_SECONDS = 600;
/**
 * decodeAudioData resamples to the context's rate. 3 kHz (the lowest the
 * spec allows) is plenty for 40 bars and keeps ten minutes near 7 MB.
 * ponytail: a pathological low-bitrate 3 MB file can still decode to about
 * an hour (~45 MB) before the duration check; stream-decode if that matters.
 */
const WAVEFORM_SAMPLE_RATE = 3000;
const PLAYBACK_RATES = [1, 1.5, 2] as const;
const SEEK_STEP_S = 5;

interface Waveform {
  peaks: number[];
  duration: number;
}

// Rows remount while the timeline scrolls; decode each file once per page.
const waveforms = new Map<string, Promise<Waveform | null>>();

async function decodeWaveform(src: string): Promise<Waveform | null> {
  try {
    const response = await fetch(src);
    const bytes = response.ok
      ? await readAtMost(response, WAVEFORM_MAX_BYTES)
      : null;
    if (!bytes) return null;
    const audio = await new OfflineAudioContext(
      1,
      1,
      WAVEFORM_SAMPLE_RATE,
    ).decodeAudioData(bytes);
    if (audio.duration > WAVEFORM_MAX_SECONDS) return null;
    return {
      peaks: voiceWaveformPeaks(audio.getChannelData(0), WAVEFORM_BARS),
      duration: audio.duration,
    };
  } catch {
    // Cannot fetch or decode here (format, network): no waveform, never a made-up one.
    return null;
  }
}

/** Decodes only once `enabled` (after the first Play), so unplayed history downloads nothing. */
function useWaveform(src: string, enabled: boolean): Waveform | null {
  const [waveform, setWaveform] = useState<Waveform | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let pending = waveforms.get(src);
    if (!pending) {
      pending = decodeWaveform(src);
      waveforms.set(src, pending);
    }
    void pending.then((value) => {
      if (!cancelled) setWaveform(value);
    });
    return () => {
      cancelled = true;
    };
  }, [src, enabled]);
  return waveform;
}

function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

export interface VoicePlayerProps {
  url: string;
  fileName: string;
  className?: string;
  transcript?: string | null;
  /** Set when the viewer may change the message; saves the new transcript. */
  /** False when the save was not sent; the dialog stays open with the text. */
  onSaveTranscript?: (transcript: string) => boolean;
}

/**
 * Compact audio card for sent messages: play, a waveform drawn from the
 * decoded file (a plain track when it cannot be decoded), speed and download,
 * with the message's transcript under it.
 */
export function VoicePlayer({
  url,
  fileName,
  className,
  transcript,
  onSaveTranscript,
}: VoicePlayerProps) {
  const t = useTranslations("Components.VoicePlayer");
  const src = stripForcedDownloadParam(url);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [started, setStarted] = useState(false);
  const waveform = useWaveform(src, started);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [mediaDuration, setMediaDuration] = useState(0);
  const [rate, setRate] = useState<(typeof PLAYBACK_RATES)[number]>(1);
  const [editing, setEditing] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const errorId = useId();

  // Recorded WebM reports Infinity until fully read; the decoded length is exact.
  const duration =
    Number.isFinite(mediaDuration) && mediaDuration > 0
      ? mediaDuration
      : (waveform?.duration ?? 0);
  const progress = duration > 0 ? Math.min(1, current / duration) : 0;

  function seek(seconds: number) {
    const audio = audioRef.current;
    if (!audio || duration <= 0) return;
    audio.currentTime = Math.min(duration, Math.max(0, seconds));
    setCurrent(audio.currentTime);
  }

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    setStarted(true);
    if (audio.paused) void audio.play().catch(() => setPlaying(false));
    else audio.pause();
  }

  function cycleRate() {
    const next =
      PLAYBACK_RATES[(PLAYBACK_RATES.indexOf(rate) + 1) % PLAYBACK_RATES.length];
    setRate(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  }

  function saveTranscript(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = new FormData(event.currentTarget).get("transcript");
    if (onSaveTranscript?.(typeof text === "string" ? text : "") === false) {
      setSaveFailed(true);
      return;
    }
    setEditing(false);
  }

  function openEditor(open: boolean) {
    setEditing(open);
    setSaveFailed(false);
  }

  return (
    <div
      className={cn(
        "flex w-full min-w-0 max-w-sm flex-col gap-1.5 rounded-md border p-2",
        className,
      )}
      data-testid="voice-player"
      title={fileName}
    >
      <div className="flex min-w-0 items-center gap-2">
        <audio
          ref={audioRef}
          src={src}
          preload="metadata"
          aria-label={fileName}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)}
          onLoadedMetadata={(event) => {
            setMediaDuration(event.currentTarget.duration);
            event.currentTarget.playbackRate = rate;
          }}
          onDurationChange={(event) =>
            setMediaDuration(event.currentTarget.duration)
          }
        />
        <Button
          type="button"
          variant="secondary"
          size="icon"
          className="shrink-0 rounded-full"
          aria-label={playing ? t("pause") : t("play", { name: fileName })}
          onClick={togglePlay}
        >
          {playing ? (
            <Pause className="size-4 fill-current" aria-hidden />
          ) : (
            <Play className="size-4 fill-current" aria-hidden />
          )}
        </Button>
        <div
          role="slider"
          tabIndex={0}
          aria-label={t("seek")}
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(current)}
          aria-valuetext={t("position", {
            current: formatClock(current),
            total: formatClock(duration),
          })}
          data-testid="voice-player-track"
          className="focus-visible:ring-ring flex h-8 min-w-0 flex-1 cursor-pointer touch-none items-center gap-px rounded outline-none focus-visible:ring-2"
          onPointerDown={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            if (box.width > 0) {
              seek(((event.clientX - box.left) / box.width) * duration);
            }
          }}
          onKeyDown={(event) => {
            const target = {
              ArrowLeft: current - SEEK_STEP_S,
              ArrowDown: current - SEEK_STEP_S,
              ArrowRight: current + SEEK_STEP_S,
              ArrowUp: current + SEEK_STEP_S,
              Home: 0,
              End: duration,
            }[event.key];
            if (target === undefined) return;
            event.preventDefault();
            seek(target);
          }}
        >
          {waveform && waveform.peaks.length > 0 ? (
            waveform.peaks.map((peak, index) => (
              <span
                // Bars are positional and never reorder.
                key={index}
                data-testid="voice-player-bar"
                className={cn(
                  "min-h-0.5 flex-1 rounded-full",
                  (index + 0.5) / waveform.peaks.length <= progress
                    ? "bg-foreground"
                    : "bg-muted-foreground",
                )}
                style={{ height: `${Math.round(peak * 100)}%` }}
              />
            ))
          ) : (
            <span className="bg-muted relative h-1 w-full overflow-hidden rounded-full">
              <span
                className="bg-foreground absolute inset-y-0 left-0"
                style={{ width: `${progress * 100}%` }}
              />
            </span>
          )}
        </div>
        <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
          {formatClock(playing || current > 0 ? current : duration)}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 shrink-0 px-2 text-xs tabular-nums"
          aria-label={t("speed", { rate: String(rate) })}
          onClick={cycleRate}
        >
          {rate}×
        </Button>
        <Button asChild variant="ghost" size="icon" className="shrink-0">
          <a
            href={url}
            target="_blank"
            rel="noreferrer noopener"
            aria-label={t("download", { name: fileName })}
          >
            <Download className="size-4" aria-hidden />
          </a>
        </Button>
      </div>
      {transcript ? (
        <details open className="text-sm">
          <summary className="text-muted-foreground cursor-pointer text-xs font-medium">
            {t("transcript")}
          </summary>
          <p className="mt-1 whitespace-pre-wrap" data-testid="voice-transcript">
            {transcript}
          </p>
        </details>
      ) : null}
      {onSaveTranscript ? (
        <Button
          type="button"
          variant="link"
          size="sm"
          className="text-muted-foreground h-auto self-start p-0 text-xs"
          onClick={() => openEditor(true)}
        >
          {transcript ? t("editTranscript") : t("addTranscript")}
        </Button>
      ) : null}
      {onSaveTranscript ? (
        <Dialog open={editing} onOpenChange={openEditor}>
          <DialogContent>
            <form onSubmit={saveTranscript} className="flex flex-col gap-4">
              <DialogHeader>
                <DialogTitle>
                  {transcript ? t("editTranscript") : t("addTranscript")}
                </DialogTitle>
                <DialogDescription>{t("transcriptHint")}</DialogDescription>
              </DialogHeader>
              <Textarea
                name="transcript"
                aria-label={t("transcript")}
                defaultValue={transcript ?? ""}
                rows={6}
                autoFocus
                aria-invalid={saveFailed || undefined}
                aria-describedby={saveFailed ? errorId : undefined}
              />
              {saveFailed ? (
                <p id={errorId} role="alert" className="text-destructive text-sm">
                  {t("transcriptNotSaved")}
                </p>
              ) : null}
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => openEditor(false)}
                >
                  {t("cancel")}
                </Button>
                <Button type="submit">{t("save")}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
