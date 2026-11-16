"use client";

import type { SetStudioAssetFeedbackData } from "@sokosumi/core-client";
import { EyeOff, MoreHorizontal, ThumbsDown, ThumbsUp } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import type { StudioAsset } from "./types";

const REASONS = [
  "off-brand",
  "bad text",
  "wrong product",
  "ugly",
  "great",
] as const;
const REASON_KEYS = {
  "off-brand": "offBrand",
  "bad text": "badText",
  "wrong product": "wrongProduct",
  ugly: "ugly",
  great: "great",
} as const;

export function StudioRating({
  asset,
  busy,
  details = false,
  onRate,
}: {
  asset: StudioAsset;
  busy?: boolean;
  details?: boolean;
  onRate: (
    asset: StudioAsset,
    input: SetStudioAssetFeedbackData["body"],
  ) => void;
}) {
  const t = useTranslations("App.Studio.Rating");
  const thumb = asset.myThumb ?? null;
  const reasons = asset.myReasons ?? [];

  return (
    <div className="space-y-3">
      <div aria-label={t("label")} className="flex gap-1" role="group">
        {([1, -1] as const).map((value) => {
          const Icon = value === 1 ? ThumbsUp : ThumbsDown;
          return (
            <Button
              aria-label={t(value === 1 ? "up" : "down")}
              aria-pressed={thumb === value}
              className={cn(
                "size-10 md:size-8",
                thumb === value && "border-foreground",
              )}
              disabled={busy}
              key={value}
              onClick={() =>
                onRate(asset, { thumb: thumb === value ? null : value })
              }
              size="icon"
              type="button"
              variant={thumb === value ? "secondary" : "default"}
            >
              <Icon
                className={cn("size-4", thumb === value && "fill-current")}
              />
            </Button>
          );
        })}
      </div>
      {details && thumb !== null ? (
        <div className="space-y-2">
          <div
            aria-label={t("reasons")}
            className="flex flex-wrap gap-2"
            role="group"
          >
            {REASONS.map((reason) => (
              <Button
                aria-pressed={reasons.includes(reason)}
                className="h-10 px-3 md:h-8"
                disabled={busy}
                key={reason}
                onClick={() =>
                  onRate(asset, {
                    thumb,
                    reasons: reasons.includes(reason)
                      ? reasons.filter((value) => value !== reason)
                      : [...reasons, reason],
                    comment: asset.myComment,
                  })
                }
                size="sm"
                type="button"
                variant={reasons.includes(reason) ? "secondary" : "outline"}
              >
                {t(REASON_KEYS[reason])}
              </Button>
            ))}
          </div>
          <Textarea
            aria-label={t("comment")}
            defaultValue={asset.myComment ?? ""}
            disabled={busy}
            key={`${asset.id}:${asset.myComment ?? ""}`}
            maxLength={500}
            onBlur={(event) => {
              const comment = event.target.value.trim() || null;
              if (comment !== (asset.myComment ?? null))
                onRate(asset, { thumb, reasons, comment });
            }}
            placeholder={t("comment")}
            rows={2}
          />
        </div>
      ) : null}
    </div>
  );
}

export function StudioAssetMenu({
  busy,
  onHide,
}: {
  busy?: boolean;
  onHide: () => void;
}) {
  const t = useTranslations("App.Studio.Rating");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={busy}>
        <Button
          aria-label={t("more")}
          className="size-10 md:size-8"
          size="icon"
          type="button"
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onHide}>
          <EyeOff />
          {t("hide")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
