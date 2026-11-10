import { useTranslations } from "next-intl";
import { useRef, useState, useTransition } from "react";

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
import { listStudioBatchAssets } from "@/lib/actions/image-studio/action";

import { readApprovedStudioHeadlines } from "./studio-approved-headlines";
import { StudioHeadlineSelect } from "./studio-headline-select";
import { StudioImage } from "./studio-image";
import { isVideoAsset, type StudioAsset, type StudioLabels } from "./types";

export function StudioBatchHeadlines({
  projectId,
  batchId,
  headlineForAsset,
  savingHeadline,
  labels,
  downloading,
  onHeadlineChange,
  onDownload,
}: {
  projectId: string;
  batchId: string;
  headlineForAsset: (asset: StudioAsset) => string;
  savingHeadline?: boolean;
  labels: StudioLabels;
  downloading?: boolean;
  onHeadlineChange: (asset: StudioAsset, headline: string) => void;
  onDownload: () => void;
}) {
  const t = useTranslations("App.Studio");
  const [review, setReview] = useState<{
    assets: StudioAsset[];
    options: string[];
  }>();
  const [failed, setFailed] = useState(false);
  const [loading, startLoad] = useTransition();
  const requestId = useRef(0);

  function load() {
    const request = ++requestId.current;
    setFailed(false);
    startLoad(async () => {
      try {
        const [assets, options] = await Promise.all([
          listStudioBatchAssets({ projectId, batchId }),
          readApprovedStudioHeadlines(projectId),
        ]);
        if (request === requestId.current) {
          setReview({
            assets: assets.filter((asset) => !isVideoAsset(asset)),
            options,
          });
        }
      } catch {
        if (request === requestId.current) setFailed(true);
      }
    });
  }

  const unavailableHeadline = review?.assets.some((asset) => {
    const headline = headlineForAsset(asset);
    return headline && !review.options.includes(headline);
  });

  return (
    <Dialog
      onOpenChange={(open) => {
        if (open) {
          setReview(undefined);
          load();
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" type="button" variant="outline">
          {t("reviewBatchHeadlines")}
        </Button>
      </DialogTrigger>
      <DialogContent className="app-scrollbar max-h-[calc(100dvh-2rem)] grid-cols-1 overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("reviewBatchHeadlines")}</DialogTitle>
          <DialogDescription>{t("reviewBatchHeadlinesHint")}</DialogDescription>
        </DialogHeader>
        {loading ? (
          <p className="text-muted-foreground text-sm" role="status">
            {t("loadingBatchHeadlines")}
          </p>
        ) : failed ? (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-muted-foreground text-sm" role="status">
              {t("batchHeadlinesLoadFailed")}
            </p>
            <Button onClick={load} size="sm" type="button" variant="ghost">
              {labels.imageRetry}
            </Button>
          </div>
        ) : review?.assets.length ? (
          <div className="min-w-0 space-y-2">
            {review.options.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                {t("batchHeadlinesEmpty")}
              </p>
            ) : null}
            <ul className="divide-border divide-y">
              {review.assets.map((asset, index) => (
                <li className="flex items-center gap-3 py-3" key={asset.id}>
                  <div className="bg-muted h-16 w-20 shrink-0 overflow-hidden rounded-md">
                    <StudioImage asset={asset} fit="contain" labels={labels} />
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-sm font-medium break-words">
                      {asset.product?.name ??
                        t("batchAdNumber", { number: index + 1 })}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {asset.width} × {asset.height}
                    </p>
                    <StudioHeadlineSelect
                      disabled={downloading || savingHeadline}
                      headline={headlineForAsset(asset)}
                      onChange={(headline) => onHeadlineChange(asset, headline)}
                      options={review.options}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm" role="status">
            {t("batchHasNoReadyAds")}
          </p>
        )}
        {savingHeadline ? (
          <p className="text-muted-foreground text-xs" role="status">
            {t("headlineSaving")}
          </p>
        ) : null}
        <DialogFooter>
          <Button
            disabled={
              !review?.assets.length ||
              loading ||
              savingHeadline ||
              unavailableHeadline
            }
            loading={downloading}
            onClick={onDownload}
            type="button"
          >
            {t("downloadBatchZip")}
          </Button>
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
