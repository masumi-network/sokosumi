import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import { StudioImage } from "./studio-image";
import { AD_PLACEMENTS, type PlacementRatio } from "./studio-placements";
import type { StudioAsset, StudioLabels } from "./types";

export function StudioAdPreview({
  asset,
  caption,
  labels,
}: {
  asset: StudioAsset;
  caption?: string;
  labels: StudioLabels;
}) {
  const t = useTranslations("App.Studio");
  const [ratio, setRatio] = useState<PlacementRatio>(
    AD_PLACEMENTS.find(({ ratio }) => ratio === asset.settings?.aspectRatio)
      ?.ratio ?? "1:1",
  );

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="secondary">
          {t("previewAd")}
        </Button>
      </DialogTrigger>
      <DialogContent
        className="app-scrollbar max-h-[calc(100dvh-2rem)] overflow-y-auto"
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle>{t("previewAd")}</DialogTitle>
          <DialogDescription>{t("previewAdDescription")}</DialogDescription>
        </DialogHeader>
        <div
          aria-label={t("adPlacements")}
          className="flex flex-wrap gap-2"
          role="group"
        >
          {AD_PLACEMENTS.map(({ label, ratio: option }) => (
            <Button
              aria-pressed={ratio === option}
              key={option}
              onClick={() => setRatio(option)}
              size="sm"
              type="button"
              variant={ratio === option ? "default" : "outline"}
            >
              {t(`Placements.${label}`)} · {option}
            </Button>
          ))}
        </div>
        <figure
          className={cn(
            "bg-card-background border-border mx-auto max-w-full min-w-0 overflow-hidden rounded-xl border",
            ratio === "9:16" ? "w-48" : "w-72",
          )}
        >
          <div className="px-3 py-2">
            <p className="text-sm font-medium break-words">
              {asset.projectName}
            </p>
            <p className="text-muted-foreground text-xs">
              {t("previewSponsored")}
            </p>
          </div>
          <div
            className="bg-muted"
            style={{ aspectRatio: ratio.replace(":", " / ") }}
          >
            <StudioImage asset={asset} labels={labels} />
          </div>
          {caption?.trim() ? (
            <figcaption className="px-3 py-2 text-sm break-words whitespace-pre-wrap">
              {caption}
            </figcaption>
          ) : null}
        </figure>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {labels.close}
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
