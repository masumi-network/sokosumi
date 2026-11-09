"use client";

import type { SokoBotAvatar } from "@sokosumi/core-client";
import { Check, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { topUpSokoBotAvatarsAction } from "@/lib/actions/soko-bot/action";
import { SOKO_BOT_AVATAR_RATE_LIMITED_ERROR_CODE } from "@/lib/soko-bot/constants";
import { cn } from "@/lib/utils";

import {
  excludeIdsForAvatarRefresh,
  nextSeenAvatarIds,
} from "./avatar-picker-exclusions";

const PAGE_SIZE = 6;

/**
 * Six unclaimed Soko Bot avatars at a time, "show others" for a fresh set. Each one is
 * unique across all bots: the pool hands an avatar to exactly one bot.
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
}

function AvatarPickerSet({
  value,
  onChange,
  currentImageUrl,
}: AvatarPickerProps) {
  const t = useTranslations("App.SokoBot.Avatar");
  const [avatars, setAvatars] = useState<SokoBotAvatar[]>([]);
  const [seen, setSeen] = useState<string[]>([]);
  const [isPending, startTransition] = useTransition();
  const [loaded, setLoaded] = useState(false);
  // The current picture takes one tile, so the set shrinks by one and the
  // tiles still fill whole rows (six wide, or two rows of three).
  const take = currentImageUrl ? PAGE_SIZE - 1 : PAGE_SIZE;

  function load(excludeIds: string[]) {
    startTransition(async () => {
      const requestedExcludeIds = excludeIdsForAvatarRefresh(excludeIds);
      const result = await topUpSokoBotAvatarsAction({
        input: { take, excludeIds: requestedExcludeIds },
      });
      if (!result.ok) {
        toast.error(
          result.error.code === SOKO_BOT_AVATAR_RATE_LIMITED_ERROR_CODE
            ? t("rateLimited")
            : t("loadError"),
        );
        // Stop the skeletons. Hitting the hourly cap is an expected answer,
        // not a pending one, and tiles that pulse for ever under the toast
        // read as "still loading".
        setLoaded(true);
        return;
      }
      // The pool is finite; when a fresh set comes back short, start over.
      const wrappedAround =
        result.value.length === 0 && requestedExcludeIds.length > 0;
      const next = wrappedAround
        ? await topUpSokoBotAvatarsAction({
            input: { take, excludeIds: [] },
          }).then((r) => (r.ok ? r.value : []))
        : result.value;
      setAvatars(next);
      // A new bot starts with a picture; picking another stays one click.
      // The pick must stay on screen: after "show others" a pick from the
      // old set is gone, so fall back to the current picture or the first.
      const pickOnScreen =
        value === null
          ? Boolean(currentImageUrl)
          : next.some((avatar) => avatar.id === value);
      if (!pickOnScreen) onChange(currentImageUrl ? null : (next[0] ?? null));
      setSeen((prev) =>
        nextSeenAvatarIds(
          prev,
          next.map((avatar) => avatar.id),
          wrappedAround ? [] : requestedExcludeIds,
        ),
      );
      setLoaded(true);
    });
  }

  useEffect(() => {
    load([]);
  }, []);

  return (
    <div className="space-y-3">
      {/* Busy while a set loads: an empty pool is drawn on the spot, which takes a while. */}
      <div
        role="group"
        aria-label={t("pictures")}
        aria-busy={isPending || !loaded}
        className="grid grid-cols-3 gap-3 sm:grid-cols-6"
      >
        {currentImageUrl ? (
          <AvatarTile
            imageUrl={currentImageUrl}
            label={t("current")}
            selected={value === null}
            onClick={() => onChange(null)}
          />
        ) : null}
        {avatars.map((avatar) => (
          <AvatarTile
            key={avatar.id}
            imageUrl={avatar.imageUrl}
            label={avatar.subject}
            selected={value === avatar.id}
            onClick={() => onChange(avatar)}
          />
        ))}
        {!loaded
          ? Array.from({ length: take }, (_, i) => (
              <div
                key={i}
                className="bg-muted aspect-square animate-pulse rounded-xl"
              />
            ))
          : null}
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-muted-foreground text-xs">{t("hint")}</p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          // The first set loads behind the skeletons; only a refresh the user
          // asked for shows (and announces) this button as busy.
          loading={isPending && loaded}
          disabled={!loaded}
          onClick={() => load(seen)}
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
