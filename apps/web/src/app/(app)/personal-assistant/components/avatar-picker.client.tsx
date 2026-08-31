"use client";

import { Check, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { listSokoBotAvatarsAction } from "@/lib/actions/soko-bot/action";
import type { SokoBotAvatar } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 6;

/**
 * Six unclaimed mascots at a time, "show others" for a fresh set. Each one is
 * unique across all bots: the pool hands an avatar to exactly one bot.
 */
export function AvatarPicker({
  value,
  onChange,
  currentImageUrl,
}: {
  value: string | null;
  onChange: (avatar: SokoBotAvatar | null) => void;
  /** The bot's current picture, shown as an always-available option. */
  currentImageUrl?: string | null;
}) {
  const t = useTranslations("App.SokoBot.Avatar");
  const [avatars, setAvatars] = useState<SokoBotAvatar[]>([]);
  const [seen, setSeen] = useState<string[]>([]);
  const [isPending, startTransition] = useTransition();
  const [loaded, setLoaded] = useState(false);

  function load(excludeIds: string[]) {
    startTransition(async () => {
      const result = await listSokoBotAvatarsAction({
        input: { take: PAGE_SIZE, excludeIds },
      });
      if (!result.ok) {
        toast.error(t("loadError"));
        return;
      }
      // The pool is finite; when a fresh set comes back short, start over.
      const next =
        result.value.length === 0 && excludeIds.length > 0
          ? await listSokoBotAvatarsAction({
              input: { take: PAGE_SIZE, excludeIds: [] },
            }).then((r) => (r.ok ? r.value : []))
          : result.value;
      setAvatars(next);
      setSeen((prev) => [...prev, ...next.map((avatar) => avatar.id)]);
      setLoaded(true);
    });
  }

  useEffect(() => {
    load([]);
  }, []);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
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
          ? Array.from({ length: PAGE_SIZE }, (_, i) => (
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
          disabled={isPending}
          onClick={() => load(seen)}
        >
          <RefreshCw
            aria-hidden
            className={cn("size-3.5", isPending && "animate-spin")}
          />
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
        "group relative aspect-square overflow-hidden rounded-xl border transition-all",
        "focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
        selected
          ? "border-primary ring-primary/30 ring-2"
          : "border-border hover:border-foreground/30",
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
