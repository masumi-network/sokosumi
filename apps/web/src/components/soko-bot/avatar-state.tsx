"use client";

import type { SokoBotAvatarState } from "@sokosumi/core-client";
import { Check } from "lucide-react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { useEffect, useState, useSyncExternalStore } from "react";

import { AVATAR_PLAY_ONCE_MS } from "@/lib/soko-bot/avatar";
import { cn } from "@/lib/utils";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeToReducedMotion(onChange: () => void) {
  const query = window.matchMedia?.(REDUCED_MOTION_QUERY);
  query?.addEventListener("change", onChange);
  return () => query?.removeEventListener("change", onChange);
}

/** True when the person asked for less motion: every avatar then shows stills. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeToReducedMotion,
    () => window.matchMedia?.(REDUCED_MOTION_QUERY).matches ?? false,
    () => false,
  );
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

/** What the bot is doing, in a line. An idle bot says when it was last active. */
export function AvatarStateLine({
  state,
  lastActivityAt,
}: {
  state: SokoBotAvatarState;
  lastActivityAt: Date | string | null;
}) {
  const t = useTranslations("Components.SokoBot.AvatarState");
  const formatter = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  if (state === "idle") {
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
    case "done":
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
    case "needs_you":
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
    case "offline":
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

/**
 * The state as a word with a mark: a filled disc, or, while the bot is busy,
 * a sweep along the pill's lower edge. Colour never carries it alone.
 */
export function AvatarStatePill({
  state,
  className,
}: {
  state: SokoBotAvatarState;
  className?: string;
}) {
  const { label } = useAvatarStateCopy();
  const busy = state === "thinking" || state === "working";
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
      {busy ? (
        <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5">
          <span
            data-slot="avatar-state-sweep"
            className="bg-foreground animate-button-loading-sweep block h-0.5 w-2/5 motion-reduce:translate-x-[75%] motion-reduce:animate-none"
          />
        </span>
      ) : null}
    </span>
  );
}
