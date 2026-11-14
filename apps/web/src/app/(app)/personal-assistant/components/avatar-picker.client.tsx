"use client";

import type { SokoBotAvatar } from "@sokosumi/core-client";
import { Check, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { topUpSokoBotAvatarsAction } from "@/lib/actions/soko-bot/action";
import {
  SOKO_BOT_AVATAR_DRAW_BUSY_ERROR_CODE,
  SOKO_BOT_AVATAR_RATE_LIMITED_ERROR_CODE,
  SOKO_BOT_AVATAR_UNAVAILABLE_ERROR_CODE,
} from "@/lib/soko-bot/constants";
import { cn } from "@/lib/utils";

import { fillAvatarRow } from "./avatar-picker-exclusions";

const PAGE_SIZE = 6;
/**
 * "Show others" draws a new set, and each image is billed, so a picker session
 * gets this many tries. Every try counts, an empty or failed one too, since
 * the image model may have billed it. Only Core's no-work answers are free
 * retries: nothing was drawn for them. Core's per-user hourly cap (24 images,
 * four sets of six) bounds the spend on the server.
 */
const MAX_AVATAR_REFRESHES = 4;

/** Core drew nothing for these, so they do not use up a try. */
const NO_WORK_ERROR_CODES: ReadonlySet<string> = new Set([
  SOKO_BOT_AVATAR_DRAW_BUSY_ERROR_CODE,
  SOKO_BOT_AVATAR_RATE_LIMITED_ERROR_CODE,
  SOKO_BOT_AVATAR_UNAVAILABLE_ERROR_CODE,
]);

/**
 * Six unclaimed Soko Bot avatars at a time, or five beside the current
 * picture; "show others" draws a fresh set, up to `MAX_AVATAR_REFRESHES`.
 * Each one is unique across all bots: the pool hands an avatar to exactly
 * one bot.
 */
export function AvatarPicker(props: AvatarPickerProps) {
  // A saved pick becomes the current picture. Remount on that change so the
  // saved avatar leaves the offered set and a fresh set fills the row again.
  return <AvatarPickerSet key={props.currentImageUrl ?? ""} {...props} />;
}

interface AvatarPickerProps {
  value: string | null;
  onChange: (avatar: SokoBotAvatar | null) => void;
  /** The bot's current picture, shown as an always-available option. */
  currentImageUrl?: string | null;
  /**
   * True while a set loads and nothing can be picked; hold saving meanwhile.
   * The picker mounts loading its first set, so start (or, on opening it,
   * reset) the mirrored state at `true`: this reports only from `load()`, so
   * the first render would otherwise disagree.
   */
  onLoadingChange?: (loading: boolean) => void;
}

function AvatarPickerSet({
  value,
  onChange,
  currentImageUrl,
  onLoadingChange,
}: AvatarPickerProps) {
  const t = useTranslations("App.SokoBot.Avatar");
  const [avatars, setAvatars] = useState<SokoBotAvatar[]>([]);
  const [seen, setSeen] = useState<SokoBotAvatar[]>([]);
  const [isPending, startTransition] = useTransition();
  const [loaded, setLoaded] = useState(false);
  // "Show others" brought nothing new: the set stays, so say why instead of
  // seeming to do nothing.
  const [noneNew, setNoneNew] = useState(false);
  const [refreshes, setRefreshes] = useState(0);
  const refreshesLeft = refreshes < MAX_AVATAR_REFRESHES;
  // The current picture takes one tile, so the set shrinks by one and the
  // tiles still fill whole rows (six wide, or two rows of three).
  const take = currentImageUrl ? PAGE_SIZE - 1 : PAGE_SIZE;

  const loading = isPending || !loaded;

  // Closing the dialog unmounts the picker mid-load. A set that lands after
  // that belongs to nobody, and a reopened picker owns the loading state.
  const mounted = useRef(true);

  function load(refresh: boolean) {
    onLoadingChange?.(true);
    startTransition(async () => {
      try {
        await loadSet(refresh);
      } finally {
        if (mounted.current) onLoadingChange?.(false);
      }
    });
  }

  /**
   * The first set reads the pool. A refresh ("show others") asks Core to draw
   * a new set and gets only that set back, so it never repeats a picture.
   * Whatever goes wrong, the current set and pick stay on screen.
   */
  async function loadSet(refresh: boolean) {
    const result = await topUpSokoBotAvatarsAction({
      input: { take, excludeIds: [], fresh: refresh },
    });
    if (refresh && (result.ok || !NO_WORK_ERROR_CODES.has(result.error.code))) {
      setRefreshes((count) => count + 1);
    }
    if (!result.ok) {
      if (result.error.code === SOKO_BOT_AVATAR_DRAW_BUSY_ERROR_CODE) {
        setNoneNew(true);
      } else {
        toast.error(
          result.error.code === SOKO_BOT_AVATAR_RATE_LIMITED_ERROR_CODE
            ? t("rateLimited")
            : t("loadError"),
        );
      }
      // Stop the skeletons. Hitting the hourly cap is an expected answer,
      // not a pending one, and tiles that pulse for ever under the toast
      // read as "still loading".
      setLoaded(true);
      return;
    }
    const fresh = result.value;
    // Nothing new: keep the set and the pick on screen.
    if (refresh && fresh.length === 0) {
      setNoneNew(true);
      return;
    }
    // A short set (the hourly cap left fewer to draw) fills the row from
    // pictures seen before so it stays full.
    const next = refresh ? fillAvatarRow(fresh, seen, take) : fresh;
    setAvatars(next);
    setNoneNew(false);
    // A new bot starts with a picture; picking another stays one click.
    // The pick must stay on screen: after "show others" a pick from the
    // old set may be gone, so fall back to the current picture or the first.
    const pickOnScreen =
      value === null
        ? Boolean(currentImageUrl)
        : next.some((avatar) => avatar.id === value);
    if (!pickOnScreen) onChange(currentImageUrl ? null : (next[0] ?? null));
    setSeen((prev) => [...prev, ...fresh]);
    setLoaded(true);
  }

  // The first set. The parent already starts loading, so the `true` from
  // `load()` confirms it and its `false` releases saving.
  useMountEffect(() => {
    mounted.current = true;
    load(false);
    return () => {
      mounted.current = false;
    };
  });

  return (
    <div className="space-y-3">
      {/* Busy while a set loads: an empty pool is drawn on the spot, which takes a while. */}
      <div
        role="group"
        aria-label={t("pictures")}
        aria-busy={loading}
        className="grid grid-cols-3 gap-3 sm:grid-cols-6"
      >
        {currentImageUrl && !loading ? (
          <AvatarTile
            imageUrl={currentImageUrl}
            label={t("current")}
            selected={value === null}
            onClick={() => onChange(null)}
          />
        ) : null}
        {(loading ? [] : avatars).map((avatar) => (
          <AvatarTile
            key={avatar.id}
            imageUrl={avatar.imageUrl}
            label={avatar.subject}
            selected={value === avatar.id}
            onClick={() => onChange(avatar)}
          />
        ))}
        {/* A refresh replaces the whole row, current picture included, so
            nothing old can be picked while the new set is on its way. */}
        {loading
          ? Array.from(
              { length: currentImageUrl ? take + 1 : take },
              (_, i) => (
                <div
                  key={i}
                  className="bg-muted aspect-square animate-pulse rounded-xl"
                />
              ),
            )
          : null}
      </div>
      <div className="flex items-center justify-between gap-3">
        <p aria-live="polite" className="text-muted-foreground text-xs">
          {isPending && loaded
            ? t("drawing")
            : !refreshesLeft
              ? t("noMore")
              : noneNew
                ? t("noneNew")
                : t("hint")}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          // The first set loads behind the skeletons; only a refresh the user
          // asked for shows (and announces) this button as busy.
          loading={isPending && loaded}
          disabled={!loaded || !refreshesLeft}
          onClick={() => load(true)}
        >
          <RefreshCw aria-hidden className="size-3.5" />
          {t("showOthers")}
        </Button>
      </div>
    </div>
  );
}

function AvatarTile({
  imageUrl,
  label,
  selected,
  onClick,
}: {
  imageUrl: string;
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      aria-label={label}
      className={cn(
        "group relative aspect-square overflow-hidden rounded-xl border transition-colors",
        "focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
        selected ? "border-foreground" : "border-border hover:border-tertiary",
      )}
    >
      <img
        src={imageUrl}
        alt=""
        className="size-full object-cover transition-transform group-hover:scale-[1.03]"
      />
      {selected ? (
        <span className="bg-primary text-primary-foreground absolute top-1.5 right-1.5 inline-flex size-5 items-center justify-center rounded-full">
          <Check aria-hidden className="size-3" />
        </span>
      ) : null}
    </button>
  );
}
