"use client";

import { Check, ChevronLeft, ChevronRight, Download, X } from "lucide-react";
import { useFormatter } from "next-intl";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { resolveModel } from "./catalog";
import { StudioImage } from "./studio-image";
import {
  assetContentUrl,
  type StudioAsset,
  type StudioCatalog,
  type StudioLabels,
} from "./types";

/**
 * One image up close, or several beside each other.
 *
 * The same surface does both on purpose. Comparing is not a separate mode with
 * its own rules — it is the detail view with more than one thing in it, so the
 * metadata, the review buttons and the download are in the same place whether
 * you are looking at one image or four. Each pane is labelled with the model
 * that made it, because comparing two images without knowing which model is
 * which is not a comparison.
 */
export function StudioLightbox({
  assets,
  busy,
  catalog,
  drafts,
  labels,
  onApprove,
  onClearReview,
  onClose,
  onDraftChange,
  onRegenerate,
  onStep,
  onUseAsReference,
  onReject,
  projectId,
  stepping,
}: {
  assets: StudioAsset[];
  busy: boolean;
  catalog: StudioCatalog;
  /**
   * Unsaved notes by version, owned by the studio.
   *
   * Local state here did not survive the component being unmounted, which is
   * what closing the lightbox does — so a note vanished on the way to look at
   * anything else.
   */
  drafts: Record<string, string>;
  labels: StudioLabels;
  onApprove: (assetId: string, feedback: string) => void;
  onClearReview: (assetId: string) => void;
  onClose: () => void;
  onDraftChange: (assetId: string, value: string) => void;
  onRegenerate: (asset: StudioAsset) => void;
  /** Move to the previous/next image; only offered while showing one. */
  onStep: (delta: number) => void;
  onUseAsReference: (asset: StudioAsset) => void;
  onReject: (assetId: string, feedback: string) => void;
  projectId: string;
  stepping: { hasPrevious: boolean; hasNext: boolean };
}) {
  // Formatted on the client: these rows arrive from a poll, so there is no
  // server render to format them in, and a raw ISO string is not a date
  // anybody reads.
  const format = useFormatter();
  const formatDate = (value: string) =>
    format.dateTime(new Date(value), "dateTime");
  const single = assets.length === 1 ? assets[0] : null;

  // Arrow keys step through the gallery, as they would in any image viewer.
  useEffect(() => {
    if (!single) return;
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "INPUT" ||
        target?.isContentEditable
      ) {
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        onStep(-1);
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        onStep(1);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onStep, single]);

  if (assets.length === 0) return null;

  const title = single
    ? `${labels.version} ${single.version}`
    : labels.compareSelected;

  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open>
      <DialogContent
        className="flex h-[92dvh] max-h-[92dvh] w-[96vw] max-w-[96vw] flex-col gap-0 overflow-hidden p-0 sm:max-w-[96vw]"
        showCloseButton={false}
      >
        <div className="border-border flex items-center justify-between gap-3 border-b px-4 py-3">
          <div className="min-w-0">
            <DialogTitle className="text-sm font-medium">{title}</DialogTitle>
            <DialogDescription className="text-muted-foreground truncate text-xs">
              {single ? single.prompt : labels.compareHint}
            </DialogDescription>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {single ? (
              <>
                <Button
                  aria-label={labels.previousVersion}
                  disabled={!stepping.hasPrevious}
                  onClick={() => onStep(-1)}
                  size="icon"
                  variant="ghost"
                >
                  <ChevronLeft aria-hidden />
                </Button>
                <Button
                  aria-label={labels.nextVersion}
                  disabled={!stepping.hasNext}
                  onClick={() => onStep(1)}
                  size="icon"
                  variant="ghost"
                >
                  <ChevronRight aria-hidden />
                </Button>
              </>
            ) : null}
            <Button
              aria-label={labels.close}
              onClick={onClose}
              size="icon"
              variant="ghost"
            >
              <X aria-hidden />
            </Button>
          </div>
        </div>

        <div
          className={cn(
            "app-scrollbar grid min-h-0 flex-1 gap-px overflow-y-auto",
            // One column per image, never a reserved empty one: comparing
            // three should use the whole width, not three quarters of it.
            // Written as whole class strings so the Tailwind scanner sees
            // them.
            assets.length === 1
              ? "grid-cols-1 lg:grid-cols-[minmax(0,1fr)_22rem]"
              : assets.length === 2
                ? "grid-cols-1 sm:grid-cols-2"
                : assets.length === 3
                  ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
                  : "grid-cols-1 sm:grid-cols-2 xl:grid-cols-4",
          )}
        >
          {assets.length === 1 && single ? (
            <>
              <ImagePane asset={single} labels={labels} projectId={projectId} />
              <aside className="app-scrollbar border-border min-w-0 overflow-y-auto border-t p-4 lg:border-t-0 lg:border-l">
                <Metadata
                  asset={single}
                  catalog={catalog}
                  formatDate={formatDate}
                  labels={labels}
                />
                <Review
                  asset={single}
                  busy={busy}
                  draft={drafts[single.id] ?? single.review?.feedback ?? ""}
                  labels={labels}
                  onApprove={onApprove}
                  onClearReview={onClearReview}
                  onDraftChange={(value) => onDraftChange(single.id, value)}
                  onReject={onReject}
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
                  <Button asChild size="sm" variant="ghost">
                    <a
                      download={`v${single.version}.${single.settings?.outputFormat ?? "png"}`}
                      href={assetContentUrl(projectId, single.id)}
                    >
                      <Download aria-hidden />
                      {labels.download}
                    </a>
                  </Button>
                </div>
              </aside>
            </>
          ) : (
            assets.map((asset) => (
              <div
                className="border-border flex min-w-0 flex-col border-r last:border-r-0"
                key={asset.id}
              >
                <ImagePane
                  asset={asset}
                  labels={labels}
                  projectId={projectId}
                />
                <div className="border-border min-w-0 border-t p-3">
                  <Metadata
                    asset={asset}
                    catalog={catalog}
                    compact
                    formatDate={formatDate}
                    labels={labels}
                  />
                  <Review
                    asset={asset}
                    busy={busy}
                    compact
                    draft={drafts[asset.id] ?? asset.review?.feedback ?? ""}
                    labels={labels}
                    onApprove={onApprove}
                    onClearReview={onClearReview}
                    onDraftChange={(value) => onDraftChange(asset.id, value)}
                    onReject={onReject}
                  />
                </div>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ImagePane({
  asset,
  labels,
  projectId,
}: {
  asset: StudioAsset;
  labels: StudioLabels;
  projectId: string;
}) {
  return (
    <figure className="bg-muted relative flex min-h-0 flex-1 items-center justify-center p-3">
      <StudioImage
        asset={asset}
        fit="contain"
        labels={labels}
        projectId={projectId}
      />
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
  formatDate,
  labels,
}: {
  asset: StudioAsset;
  catalog: StudioCatalog;
  compact?: boolean;
  formatDate: (value: string) => string;
  labels: StudioLabels;
}) {
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

function Review({
  asset,
  busy,
  compact,
  draft,
  labels,
  onApprove,
  onClearReview,
  onDraftChange,
  onReject,
}: {
  asset: StudioAsset;
  busy: boolean;
  compact?: boolean;
  draft: string;
  labels: StudioLabels;
  onApprove: (assetId: string, feedback: string) => void;
  onClearReview: (assetId: string) => void;
  onDraftChange: (value: string) => void;
  onReject: (assetId: string, feedback: string) => void;
}) {
  const decision = asset.review?.decision ?? null;

  return (
    <div className={cn("space-y-2", compact ? "mt-2" : "mt-4")}>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          aria-pressed={decision === "APPROVED"}
          disabled={busy}
          onClick={() => onApprove(asset.id, draft)}
          size="sm"
          variant={decision === "APPROVED" ? "default" : "secondary"}
        >
          <Check aria-hidden />
          {labels.approve}
        </Button>
        <Button
          aria-pressed={decision === "REJECTED"}
          disabled={busy}
          onClick={() => onReject(asset.id, draft)}
          size="sm"
          variant={decision === "REJECTED" ? "default" : "secondary"}
        >
          <X aria-hidden />
          {labels.reject}
        </Button>
        {decision ? (
          <Button
            disabled={busy}
            onClick={() => onClearReview(asset.id)}
            size="sm"
            variant="ghost"
          >
            {labels.clearReview}
          </Button>
        ) : null}
      </div>
      <Textarea
        aria-label={labels.feedbackPlaceholder}
        // `text-sm`, not `text-xs`: this is something a person writes in, and
        // the app types every input at the body scale.
        className="min-h-14 text-sm"
        onChange={(event) => onDraftChange(event.currentTarget.value)}
        placeholder={labels.feedbackPlaceholder}
        value={draft}
      />
    </div>
  );
}
