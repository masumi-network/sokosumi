"use client";

import { SokoBotAvatarState } from "@sokosumi/core-client";
import { Check } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { ButtonLoadingBar } from "@/components/ui/button-loading-bar";
import { AVATAR_PLAY_ONCE_MS, type AvatarSources } from "@/lib/soko-bot/avatar";
import { cn } from "@/lib/utils";

/**
 * The picture to show: the state's loop while `playing`, else its still. A
 * person who prefers reduced motion, a legacy avatar and a loop that is not
 * rendered yet all get the still.
 */
export function useAvatarImage(
  sources: AvatarSources,
  playing: boolean,
  loop: "loop" | "loopLarge",
): string | null {
  const reducedMotion = useReducedMotion();
  return (playing && !reducedMotion ? sources[loop] : null) ?? sources.still;
}

/**
 * True for four seconds after `key` changes (and after mount when
 * `playOnMount`), then false. An avatar plays its state while this is true and
 * rests on its still otherwise.
 */
export function usePlayOnce(key: string, playOnMount: boolean): boolean {
  const [playing, setPlaying] = useState(playOnMount);
  const [seenKey, setSeenKey] = useState(key);
  if (seenKey !== key) {
    setSeenKey(key);
    setPlaying(true);
  }
  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(() => setPlaying(false), AVATAR_PLAY_ONCE_MS);
    return () => clearTimeout(timer);
  }, [playing, key]);
  return playing;
}

/** The words for an avatar state, and the alt text that names bot and state. */
export function useAvatarStateCopy() {
  const t = useTranslations("Components.SokoBot.AvatarState");
  return {
    label: (state: SokoBotAvatarState) => t(`label.${state}`),
    alt: (name: string, state: SokoBotAvatarState) =>
      t("alt", { name, state: t(`label.${state}`) }),
  };
}

interface AvatarStateLineProps {
  state: SokoBotAvatarState;
  lastActivityAt: Date | string | null;
}

/** What the bot is doing, in a line. An idle bot says when it was last active. */
export function AvatarStateLine({
  state,
  lastActivityAt,
}: AvatarStateLineProps) {
  const t = useTranslations("Components.SokoBot.AvatarState");
  const formatter = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  if (state === SokoBotAvatarState.IDLE) {
    return lastActivityAt
      ? t("lastActive", {
          time: formatter.relativeTime(new Date(lastActivityAt), now),
        })
      : t("line.idle");
  }
  return t(`line.${state}`);
}

function StateDisc({ state }: { state: SokoBotAvatarState }) {
  const base =
    "flex size-3.5 shrink-0 items-center justify-center rounded-full";
  switch (state) {
    case SokoBotAvatarState.DONE:
      return (
        <span
          aria-hidden
          className={cn(
            base,
            "bg-semantic-success text-semantic-success-foreground",
          )}
        >
          <Check className="size-2.5" strokeWidth={4} />
        </span>
      );
    case SokoBotAvatarState.NEEDS_YOU:
      return (
        <span
          aria-hidden
          className={cn(
            base,
            "bg-semantic-warning text-semantic-warning-foreground",
          )}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={4}
            strokeLinecap="round"
            className="size-2.5"
          >
            <path d="M12 5v9M12 19h.01" />
          </svg>
        </span>
      );
    case SokoBotAvatarState.OFFLINE:
      return <span aria-hidden className={cn(base, "bg-muted-foreground")} />;
    default:
      return (
        <span
          aria-hidden
          className={cn(base, "border-muted-foreground border-2")}
        />
      );
  }
}

interface AvatarStatePillProps {
  state: SokoBotAvatarState;
  className?: string;
}

/**
 * The state as a word with a mark: a filled disc, or, while the bot is busy,
 * a sweep along the pill's lower edge. Colour never carries it alone.
 */
export function AvatarStatePill({ state, className }: AvatarStatePillProps) {
  const { label } = useAvatarStateCopy();
  const busy =
    state === SokoBotAvatarState.THINKING ||
    state === SokoBotAvatarState.WORKING;
  return (
    <span
      data-slot="avatar-state-pill"
      data-state={state}
      className={cn(
        "border-border bg-background text-foreground relative inline-flex h-6 shrink-0 items-center gap-1.5 overflow-hidden rounded-full border text-xs font-medium",
        busy ? "px-2.5" : "pr-2.5 pl-1.5",
        className,
      )}
    >
      {busy ? null : <StateDisc state={state} />}
      {label(state)}
      {busy ? <ButtonLoadingBar label={label(state)} /> : null}
    </span>
  );
}
