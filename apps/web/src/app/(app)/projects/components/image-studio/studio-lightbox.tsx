"use client";

import { X } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { ImageViewer } from "@/components/ui/image-viewer";
import { cn } from "@/lib/utils";

import { resolveModel } from "./catalog";
import { StudioImage } from "./studio-image";
import {
  assetContentUrl,
  formatElapsed,
  type StudioAsset,
  type StudioCatalog,
  type StudioLabels,
} from "./types";

/**
 * One image up close, or several beside each other.
 *
 * The same surface does both on purpose. Comparing is not a separate mode with
 * its own rules — it is the detail view with more than one thing in it, so the
 * metadata and the download are in the same place whether
 * you are looking at one image or four. Each pane is labelled with the model
 * that made it, because comparing two images without knowing which model is
 * which is not a comparison.
 */
export function StudioLightbox({
  assets,
  catalog,
  creditsByAssetId,
  elapsedByAssetId,
  labels,
  onClose,
  onRegenerate,
  onSelect,
  onUseAsReference,
  siblings,
}: {
  assets: StudioAsset[];
  catalog: StudioCatalog;
  /** What each version was debited, in credits; absent when unknown. */
  creditsByAssetId: Record<string, number>;
  /** How long the provider took per version, in milliseconds. */
  elapsedByAssetId: Record<string, number>;
  labels: StudioLabels;
  onClose: () => void;
  onRegenerate: (asset: StudioAsset) => void;
  /** Step to another image while showing one; arrows and swipes live in the viewer. */
  onSelect: (assetId: string) => void;
  onUseAsReference: (asset: StudioAsset) => void;
  /** Every image the viewer can step through, in gallery order. */
  siblings: StudioAsset[];
}) {
  // Formatted on the client: these rows arrive from a poll, so there is no
  // server render to format them in, and a raw ISO string is not a date
  // anybody reads.
  const format = useFormatter();
  const formatDate = (value: string) =>
    format.dateTime(new Date(value), "dateTime");
  const single = assets.length === 1 ? assets[0] : null;

  if (assets.length === 0) return null;

  if (single) {
    const url = assetContentUrl(single);
    const ext = single.settings?.outputFormat ?? "png";
    return (
      <ImageViewer
        activeSrc={url}
        aside={
          <>
            <Metadata
              asset={single}
              catalog={catalog}
              credits={creditsByAssetId[single.id] ?? null}
              elapsed={elapsedByAssetId[single.id] ?? null}
              formatDate={formatDate}
              labels={labels}
            />
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                onClick={() => onRegenerate(single)}
                size="sm"
                variant="secondary"
              >
                {labels.regenerate}
              </Button>
              <Button
                onClick={() => onUseAsReference(single)}
                size="sm"
                variant="secondary"
              >
                {labels.refine}
              </Button>
            </div>
          </>
        }
        images={siblings.map((asset) => ({
          src: assetContentUrl(asset),
          alt: asset.prompt,
          downloadFilename: `v${asset.version}.${asset.settings?.outputFormat ?? ext}`,
        }))}
        onActiveSrcChange={(src) => {
          const next = siblings.find((asset) => assetContentUrl(asset) === src);
          if (next) onSelect(next.id);
          else if (src === null) onClose();
        }}
      />
    );
  }

  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open>
      <DialogContent
        className="flex h-[92dvh] max-h-[92dvh] w-[96vw] max-w-[96vw] flex-col gap-0 overflow-hidden p-0 sm:max-w-[96vw]"
        showCloseButton={false}
      >
        <div className="border-border flex items-center justify-between gap-3 border-b px-4 py-3">
          <div className="min-w-0">
            <DialogTitle className="text-sm font-medium">
              {labels.compareSelected}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground truncate text-xs">
              {labels.compareHint}
            </DialogDescription>
          </div>
          <Button
            aria-label={labels.close}
            onClick={onClose}
            size="icon"
            variant="ghost"
          >
            <X aria-hidden />
          </Button>
        </div>

        <div
          className={cn(
            "app-scrollbar grid min-h-0 flex-1 gap-px overflow-y-auto",
            // One column per image, never a reserved empty one. Written as
            // whole class strings so the Tailwind scanner sees them.
            assets.length === 2
              ? "grid-cols-1 sm:grid-cols-2"
              : assets.length === 3
                ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
                : "grid-cols-1 sm:grid-cols-2 xl:grid-cols-4",
          )}
        >
          {assets.map((asset) => (
            <div
              className="border-border flex min-w-0 flex-col border-r last:border-r-0"
              key={asset.id}
            >
              <ImagePane asset={asset} labels={labels} />
              <div className="border-border min-w-0 border-t p-3">
                <Metadata
                  asset={asset}
                  catalog={catalog}
                  compact
                  credits={creditsByAssetId[asset.id] ?? null}
                  elapsed={elapsedByAssetId[asset.id] ?? null}
                  formatDate={formatDate}
                  labels={labels}
                />
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ImagePane({
  asset,
  labels,
}: {
  asset: StudioAsset;
  labels: StudioLabels;
}) {
  return (
    <figure className="bg-muted relative flex min-h-0 flex-1 items-center justify-center p-3">
      <StudioImage asset={asset} fit="contain" labels={labels} />
      <figcaption className="bg-card-background text-foreground border-border absolute top-5 left-5 rounded-md border px-2 py-0.5 text-xs">
        {labels.version} {asset.version}
      </figcaption>
    </figure>
  );
}

/** Everything the studio kept about how this image was made. */
function Metadata({
  asset,
  catalog,
  compact,
  credits,
  elapsed,
  formatDate,
  labels,
}: {
  asset: StudioAsset;
  catalog: StudioCatalog;
  compact?: boolean;
  /** `null` is unknown, `0` is free: never collapse the two. */
  credits: number | null;
  elapsed: number | null;
  formatDate: (value: string) => string;
  labels: StudioLabels;
}) {
  const t = useTranslations("App.Studio");
  const model = resolveModel(catalog, asset.model);

  return (
    <dl className="space-y-1.5 text-xs">
      <Field label={labels.model}>
        <span className={cn(!model.known && "font-mono break-all")}>
          {model.label}
        </span>
        {!model.known ? (
          <span className="text-muted-foreground block">
            {labels.modelNotInCatalog}
          </span>
        ) : null}
      </Field>
      <Field label={labels.dimensions}>
        <span className="tabular-nums">
          {asset.width}×{asset.height} · {asset.settings?.aspectRatio ?? "—"} ·{" "}
          {asset.settings?.resolution ?? "—"}
        </span>
      </Field>
      <Field label={labels.seed}>
        <span className="tabular-nums">
          {asset.settings?.seed ?? labels.noSeed}
        </span>
      </Field>
      {elapsed === null ? null : (
        <Field label={labels.generationTime}>
          <span className="tabular-nums">{formatElapsed(elapsed)}</span>
        </Field>
      )}
      {credits === null ? null : (
        <Field label={labels.credits}>
          <span className="tabular-nums">
            {t("creditsCount", { count: credits })}
          </span>
        </Field>
      )}
      <Field label={labels.created}>
        <span>{formatDate(asset.createdAt as unknown as string)}</span>
      </Field>
      {asset.parentId ? (
        <Field label={labels.lineage}>
          <span>{labels.parentVersion}</span>
        </Field>
      ) : null}
      {compact ? null : (
        <Field label={labels.from}>
          <span className="whitespace-pre-wrap">{asset.prompt}</span>
        </Field>
      )}
    </dl>
  );
}

function Field({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}
