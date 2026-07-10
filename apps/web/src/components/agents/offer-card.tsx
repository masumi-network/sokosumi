"use client";

import {
  AlignLeft,
  AppWindow,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Boxes,
  Clapperboard,
  Code,
  ExternalLink,
  FileText,
  ImageIcon,
  ListChecks,
  PenLine,
  Play,
  Presentation,
  Table,
  Users,
} from "lucide-react";
import { type ReactNode, useState } from "react";

import { VendorMark } from "@/components/agents/company-mark";
import Markdown from "@/components/markdown";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Vendor } from "@/lib/clients/generated/core";
import type { CoworkerOffer } from "@/lib/types/coworker";
import { cn } from "@/lib/utils";

export type OfferOutput = NonNullable<CoworkerOffer["outputs"]>[number];
export type OutputKind = OfferOutput["type"];
const OUTPUT_ICON: Record<OutputKind, typeof FileText> = {
  pdf: FileText,
  doc: FileText,
  slides: Presentation,
  sheet: Table,
  image: ImageIcon,
  text: AlignLeft,
  html: AppWindow,
};
// English fallback labels for the output chip when no translated typeLabel is
// supplied (e.g. the New Task picker, which has no output-type translations).
const DEFAULT_OUTPUT_LABEL: Record<OutputKind, string> = {
  pdf: "PDF",
  doc: "Doc",
  slides: "Slides",
  sheet: "Sheet",
  image: "Image",
  text: "Text",
  html: "Web",
};
function defaultTypeLabel(type: OutputKind): string {
  return DEFAULT_OUTPUT_LABEL[type];
}
/** An offer's outputs, defaulting to a single text output when none are set. */
export function offerOutputs(offer: CoworkerOffer): OfferOutput[] {
  const outs = offer.outputs ?? [];
  return outs.length ? outs : [{ type: "text" }];
}

// Office files need the Microsoft viewer to embed; PDFs/images embed natively.
const OFFICE_FILE = /\.(pptx?|docx?|xlsx?)(\?|#|$)/i;
export function isOfficeFile(url: string): boolean {
  return OFFICE_FILE.test(url);
}
// Office document kinds — these must go through the Office viewer regardless of
// the URL's extension, otherwise the browser downloads them instead of showing them.
const OFFICE_EXT: Partial<Record<OutputKind, string>> = {
  doc: "docx",
  slides: "pptx",
  sheet: "xlsx",
};
export function isOfficeType(type: OutputKind): boolean {
  return type in OFFICE_EXT;
}
export function officeViewerUrl(url: string, type?: OutputKind): string {
  // The Office viewer identifies the format from the URL's file extension.
  // Extensionless URLs (e.g. IPFS hashes) need a filename hint or the viewer
  // can't open them — append one derived from the output type.
  let src = url;
  if (!isOfficeFile(url)) {
    const ext = (type && OFFICE_EXT[type]) ?? "docx";
    src = `${url}${url.includes("?") ? "&" : "?"}filename=file.${ext}`;
  }
  return `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(src)}`;
}

export function OutputTypeIcon({
  type,
  className,
}: {
  type: OutputKind;
  className?: string;
}) {
  const Icon = OUTPUT_ICON[type];
  return <Icon aria-hidden className={className} />;
}

type MockKind =
  | "slides"
  | "page"
  | "sheet"
  | "image"
  | "text"
  | "chart"
  | "checklist"
  | "code"
  | "wireframe"
  | "video"
  | "web";

// Category → icon + a content-flavored mock, so offers read distinct from one another.
const CATEGORY_ICON: Record<string, typeof FileText> = {
  Research: BarChart3,
  Planning: ListChecks,
  Coordination: Users,
  Engineering: Code,
  Presentations: Presentation,
  Prototyping: Boxes,
  Writing: PenLine,
  Social: Clapperboard,
};
const CATEGORY_MOCK: Record<string, MockKind> = {
  Research: "chart",
  Planning: "checklist",
  Coordination: "checklist",
  Engineering: "code",
  Presentations: "slides",
  Prototyping: "wireframe",
  Writing: "text",
  Social: "video",
};

// Per-category accent drawn from the project's chart palette (--chart-1..5).
interface CategoryColor {
  chip: string;
  accent: string;
  ring: string;
}
const NEUTRAL_COLOR: CategoryColor = {
  chip: "bg-background/90",
  accent: "bg-foreground/30",
  ring: "border-muted-foreground/30",
};
const CHART_COLOR: Record<number, CategoryColor> = {
  1: { chip: "bg-chart-1/15", accent: "bg-chart-1", ring: "border-chart-1" },
  2: { chip: "bg-chart-2/15", accent: "bg-chart-2", ring: "border-chart-2" },
  3: { chip: "bg-chart-3/15", accent: "bg-chart-3", ring: "border-chart-3" },
  4: { chip: "bg-chart-4/15", accent: "bg-chart-4", ring: "border-chart-4" },
  5: { chip: "bg-chart-5/15", accent: "bg-chart-5", ring: "border-chart-5" },
};
const CATEGORY_CHART: Record<string, number> = {
  Research: 1,
  Planning: 4,
  Coordination: 5,
  Engineering: 3,
  Presentations: 2,
  Prototyping: 1,
  Writing: 3,
  Social: 2,
};
function categoryColor(category?: string): CategoryColor {
  const index = category ? CATEGORY_CHART[category] : undefined;
  return index ? CHART_COLOR[index] : NEUTRAL_COLOR;
}

function categoryIcon(category?: string): typeof FileText {
  return (category && CATEGORY_ICON[category]) || FileText;
}
function CategoryIcon({
  category,
  className,
}: {
  category?: string;
  className?: string;
}) {
  const Icon = categoryIcon(category);
  return <Icon aria-hidden className={className} />;
}

/** A file output drives the mock by file type; a text-only output borrows its category's flavor. */
function mockKind(offer: CoworkerOffer): MockKind {
  const primary = offerOutputs(offer)[0];
  if (primary.type === "image" && primary.url) return "image";
  if (primary.type === "slides") return "slides";
  if (primary.type === "sheet") return "sheet";
  if (primary.type === "html") return "web";
  if ((primary.type === "pdf" || primary.type === "doc") && primary.url) {
    return "page";
  }
  return CATEGORY_MOCK[offer.category ?? ""] ?? "text";
}

// Stable keys for the decorative 4×4 spreadsheet grid (avoids array-index keys).
const SHEET_CELLS = Array.from(
  { length: 16 },
  (_cell, index) => `r${Math.floor(index / 4)}c${index % 4}`,
);

/** Stylized skeleton of the output — decorative, no fabricated content. One element
 * carries the category accent so the preview is color-cued without becoming a wash. */
function OfferMock({
  kind,
  accent,
  ring,
}: {
  kind: MockKind;
  accent: string;
  ring: string;
}) {
  if (kind === "slides") {
    return (
      <div className="flex h-full items-center justify-center p-5">
        <div className="ring-border w-full max-w-[82%] overflow-hidden rounded-md bg-card shadow-sm ring-1">
          <div className={cn("h-2.5", accent)} />
          <div className="space-y-2 p-3">
            <div className="bg-foreground/15 h-2 w-2/3 rounded" />
            <div className="bg-muted-foreground/25 h-1.5 w-full rounded" />
            <div className="bg-muted-foreground/25 h-1.5 w-5/6 rounded" />
            <div className="bg-muted-foreground/25 h-1.5 w-3/4 rounded" />
          </div>
        </div>
      </div>
    );
  }
  if (kind === "page") {
    return (
      <div className="flex h-full items-center justify-center p-5">
        <div className="ring-border h-full w-1/2 overflow-hidden rounded-sm bg-card p-3 shadow-sm ring-1">
          <div className={cn("mb-2 h-2 w-3/4 rounded", accent)} />
          <div className="space-y-1.5">
            <div className="bg-muted-foreground/25 h-1 w-full rounded" />
            <div className="bg-muted-foreground/25 h-1 w-full rounded" />
            <div className="bg-muted-foreground/25 h-1 w-5/6 rounded" />
            <div className="bg-muted-foreground/25 h-1 w-full rounded" />
            <div className="bg-muted-foreground/25 h-1 w-2/3 rounded" />
          </div>
        </div>
      </div>
    );
  }
  if (kind === "chart") {
    return (
      <div className="flex h-full items-center justify-center p-5">
        <div className="ring-border w-full max-w-[82%] overflow-hidden rounded-md bg-card p-3 shadow-sm ring-1">
          <div className="bg-foreground/15 mb-3 h-2 w-1/2 rounded" />
          <div className="flex h-12 items-end gap-1.5">
            <div className="bg-muted-foreground/30 h-[40%] flex-1 rounded-sm" />
            <div className="bg-muted-foreground/30 h-[70%] flex-1 rounded-sm" />
            <div className="bg-muted-foreground/30 h-[55%] flex-1 rounded-sm" />
            <div className={cn("h-[90%] flex-1 rounded-sm", accent)} />
            <div className="bg-muted-foreground/30 h-[60%] flex-1 rounded-sm" />
          </div>
        </div>
      </div>
    );
  }
  if (kind === "checklist") {
    return (
      <div className="flex h-full flex-col justify-center gap-2.5 px-8">
        {["w-4/5", "w-full", "w-3/5", "w-3/4"].map((width) => (
          <div key={width} className="flex items-center gap-2">
            <div
              className={cn("size-3 shrink-0 rounded-full border-2", ring)}
            />
            <div
              className={cn("bg-muted-foreground/25 h-1.5 rounded", width)}
            />
          </div>
        ))}
      </div>
    );
  }
  if (kind === "code") {
    return (
      <div className="flex h-full items-center justify-center p-5">
        <div className="ring-border w-full max-w-[82%] space-y-1.5 overflow-hidden rounded-md bg-card p-3 shadow-sm ring-1">
          <div className={cn("h-1.5 w-2/5 rounded", accent)} />
          <div className="bg-muted-foreground/25 ml-3 h-1.5 w-3/5 rounded" />
          <div className="bg-muted-foreground/25 ml-3 h-1.5 w-1/2 rounded" />
          <div className="bg-muted-foreground/25 ml-6 h-1.5 w-2/5 rounded" />
          <div className="bg-muted-foreground/25 h-1.5 w-1/4 rounded" />
        </div>
      </div>
    );
  }
  if (kind === "wireframe") {
    return (
      <div className="flex h-full items-center justify-center p-5">
        <div className="ring-border w-full max-w-[82%] space-y-2 overflow-hidden rounded-md bg-card p-3 shadow-sm ring-1">
          <div className={cn("h-3 w-full rounded", accent)} />
          <div className="flex gap-2">
            <div className="bg-muted-foreground/20 h-10 flex-1 rounded" />
            <div className="bg-muted-foreground/20 h-10 flex-1 rounded" />
          </div>
          <div className="bg-muted-foreground/15 h-2 w-3/4 rounded" />
        </div>
      </div>
    );
  }
  if (kind === "video") {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="ring-border bg-muted-foreground/15 relative h-[82%] w-[34%] overflow-hidden rounded-lg shadow-sm ring-1">
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="bg-background/90 flex size-7 items-center justify-center rounded-full">
              <Play
                aria-hidden
                className="text-foreground ml-0.5 size-3 fill-current"
              />
            </div>
          </div>
        </div>
      </div>
    );
  }
  if (kind === "web") {
    return (
      <div className="flex h-full items-center justify-center p-5">
        <div className="ring-border w-full max-w-[82%] overflow-hidden rounded-md bg-card shadow-sm ring-1">
          <div className="bg-muted/60 flex items-center gap-1 border-b px-2 py-1.5">
            <span className="bg-muted-foreground/30 size-1.5 rounded-full" />
            <span className="bg-muted-foreground/30 size-1.5 rounded-full" />
            <span className="bg-muted-foreground/30 size-1.5 rounded-full" />
          </div>
          <div className="space-y-2 p-3">
            <div className={cn("h-6 w-full rounded", accent)} />
            <div className="bg-muted-foreground/20 h-1.5 w-2/3 rounded" />
            <div className="bg-muted-foreground/20 h-1.5 w-1/2 rounded" />
          </div>
        </div>
      </div>
    );
  }
  if (kind === "sheet") {
    return (
      <div className="flex h-full items-center justify-center p-5">
        <div className="ring-border w-full max-w-[82%] overflow-hidden rounded-md bg-card shadow-sm ring-1">
          <div className={cn("h-2 w-full", accent)} />
          <div className="grid grid-cols-4">
            {SHEET_CELLS.map((cell) => (
              <div
                key={cell}
                className="border-border/60 h-3.5 border-r border-b last:border-r-0"
              />
            ))}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col justify-center gap-2 px-7">
      <div className={cn("h-1.5 w-2/5 rounded", accent)} />
      <div className="bg-muted-foreground/25 h-1.5 w-full rounded" />
      <div className="bg-muted-foreground/25 h-1.5 w-5/6 rounded" />
      <div className="bg-muted-foreground/25 h-1.5 w-full rounded" />
      <div className="bg-muted-foreground/25 h-1.5 w-2/3 rounded" />
    </div>
  );
}

/** Card preview — a content-aware mock of the primary output (no heavy embeds in the grid). */
function OfferThumb({
  offer,
  typeLabel,
}: {
  offer: CoworkerOffer;
  typeLabel: (type: OutputKind) => string;
}) {
  const outputs = offerOutputs(offer);
  const primary = outputs[0];
  const Icon = OUTPUT_ICON[primary.type];
  const chipLabel =
    outputs.length > 1
      ? `${typeLabel(primary.type)} +${outputs.length - 1}`
      : typeLabel(primary.type);
  const mock = mockKind(offer);
  const color = categoryColor(offer.category);
  return (
    <div className="bg-muted/40 relative aspect-[16/10] overflow-hidden">
      {mock === "image" && primary.url ? (
        // eslint-disable-next-line @next/next/no-img-element -- arbitrary remote example host
        <img
          src={primary.url}
          alt={offer.title}
          className="size-full object-cover"
          loading="lazy"
        />
      ) : (
        <OfferMock kind={mock} accent={color.accent} ring={color.ring} />
      )}
      <div className="bg-background/90 text-foreground absolute right-3 bottom-3 inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium backdrop-blur">
        <Icon aria-hidden className="size-3" />
        {chipLabel}
      </div>
    </div>
  );
}

const FOCUS_RING =
  "focus-visible:ring-primary/40 outline-none focus-visible:ring-2";

interface OfferCardProps {
  offer: CoworkerOffer;
  /** Optional translated output-type labels; falls back to English defaults. */
  typeLabel?: (type: OutputKind) => string;
  onClick: () => void;
  /** Optional coworker footer — shown in the marketplace, omitted in the New Task picker. */
  coworkerName?: string;
  coworkerAvatar?: ReactNode;
}

export function OfferCard({
  offer,
  typeLabel,
  onClick,
  coworkerName,
  coworkerAvatar,
}: OfferCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group bg-card border-border/60 flex flex-col overflow-hidden rounded-2xl border text-left transition-all duration-200 hover:border-primary hover:shadow-sm active:scale-[0.99]",
        FOCUS_RING,
      )}
    >
      <div className="relative overflow-hidden border-b">
        <OfferThumb offer={offer} typeLabel={typeLabel ?? defaultTypeLabel} />
        {offer.category ? (
          <span
            className={cn(
              "text-foreground absolute top-3 left-3 inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium backdrop-blur",
              categoryColor(offer.category).chip,
            )}
          >
            <CategoryIcon category={offer.category} className="size-3" />
            {offer.category}
          </span>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="space-y-1">
          <h3 className="text-foreground font-medium text-balance">
            {offer.title}
          </h3>
          {offer.description ? (
            <p className="text-muted-foreground line-clamp-2 text-sm leading-relaxed text-pretty">
              {offer.description}
            </p>
          ) : null}
        </div>

        <div className="mt-auto flex items-center gap-2 pt-1">
          {coworkerAvatar}
          {coworkerName ? (
            <span className="text-muted-foreground truncate text-xs">
              {coworkerName}
            </span>
          ) : null}
          <ArrowUpRight
            aria-hidden
            className="text-muted-foreground group-hover:text-foreground ml-auto size-4 transition-colors"
          />
        </div>
      </div>
    </button>
  );
}

/** Detail preview — one output embedded for real (PDF/Office/image), or a text
 *  placeholder. Fills its container so a dialog can give it a large viewport. */
export function OfferEmbed({
  output,
  title,
  pendingLabel,
}: {
  output: OfferOutput;
  title: string;
  pendingLabel: string;
}) {
  const { type, url, text } = output;
  if (url && type === "image") {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- arbitrary remote example host
      <img
        src={url}
        alt={title}
        className="bg-muted/40 h-full w-full object-contain"
        loading="lazy"
      />
    );
  }
  // HTML outputs run in a sandboxed iframe so their scripts execute (e.g. a
  // Three.js hero) but stay isolated from the app — no same-origin access.
  if (type === "html" && (text || url)) {
    return (
      <iframe
        title={title}
        sandbox="allow-scripts"
        className="bg-background h-full w-full"
        loading="lazy"
        {...(text ? { srcDoc: text } : { src: url })}
      />
    );
  }
  if (url) {
    // Office documents must use the viewer (the browser would download them);
    // route by the declared type so extensionless URLs still embed. PDFs render
    // natively — hide the browser's PDF chrome (toolbar / thumbnail rail).
    const src =
      isOfficeType(type) || isOfficeFile(url)
        ? officeViewerUrl(url, type)
        : `${url}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`;
    return (
      <iframe src={src} title={title} className="bg-muted/40 h-full w-full" />
    );
  }
  // Text outputs render their inline example as a real document "page" — a
  // titled sheet with document-grade typography (not a cramped markdown blob).
  if (text) {
    const docTitle = output.label ?? title;
    return (
      <div className="bg-muted/40 h-full w-full overflow-y-auto p-4 md:p-6">
        <article className="bg-background border-border/70 mx-auto max-w-2xl overflow-hidden rounded-xl border shadow-md">
          {/* Document letterhead */}
          <div className="border-border/60 flex items-center gap-2.5 border-b px-7 py-3.5 md:px-10">
            <span className="bg-primary/10 text-primary flex size-7 shrink-0 items-center justify-center rounded-md">
              <FileText className="size-4" aria-hidden />
            </span>
            <p className="text-foreground truncate text-sm font-medium">
              {docTitle}
            </p>
          </div>
          {/* Document body */}
          <div className="px-7 py-7 md:px-10 md:py-9">
            <Markdown
              className={cn(
                "prose-h2:text-xl prose-h2:mb-3 prose-h2:tracking-tight",
                "prose-h3:text-foreground prose-h3:mt-7 prose-h3:mb-2 prose-h3:text-base",
                "prose-p:text-foreground/90 prose-p:text-[15px] prose-p:leading-7",
                "prose-li:text-foreground/90 prose-li:my-1.5 prose-li:text-[15px] prose-li:leading-7",
                "prose-ul:my-3 prose-ol:my-3 prose-strong:text-foreground",
              )}
            >
              {text}
            </Markdown>
          </div>
        </article>
      </div>
    );
  }
  return (
    <div className="bg-muted/40 flex h-full flex-col items-center justify-center gap-3 px-10">
      <AlignLeft aria-hidden className="text-muted-foreground/50 size-9" />
      <div className="w-full max-w-md space-y-2">
        <div className="bg-muted-foreground/20 h-1.5 w-full rounded" />
        <div className="bg-muted-foreground/20 h-1.5 w-11/12 rounded" />
        <div className="bg-muted-foreground/20 h-1.5 w-4/5 rounded" />
        <div className="bg-muted-foreground/20 h-1.5 w-2/3 rounded" />
      </div>
      <span className="text-muted-foreground text-xs">{pendingLabel}</span>
    </div>
  );
}

export interface OfferDetailItem {
  offer: CoworkerOffer;
  coworkerName: string;
  coworkerCaption?: string;
  vendor?: Pick<Vendor, "name" | "slug" | "logos">;
  /** Rendered coworker avatar (so callers keep their own avatar component). */
  coworkerAvatar: ReactNode;
  /** Rendered model/region tags. */
  metaTags?: ReactNode;
}

export interface OfferDetailLabels {
  start: string;
  deliveredBy?: string;
  deliverable?: string;
  pending?: string;
  openInNewTab?: string;
  fallbackTitle?: string;
}

/** Shared rich preview of a ready-to-run task — output tabs + live preview on the
 *  left, details + start action on the right. Used by both the agents marketplace
 *  and the New Task spotlight so the two previews are identical. */
export function OfferDetailDialog({
  item,
  onClose,
  onStart,
  typeLabel,
  labels,
}: {
  item: OfferDetailItem | null;
  onClose: () => void;
  onStart: () => void;
  typeLabel?: (type: OutputKind) => string;
  labels: OfferDetailLabels;
}) {
  return (
    <Dialog
      open={item != null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[92dvh] gap-0 overflow-hidden p-0 sm:max-w-5xl lg:max-w-6xl">
        {item ? (
          <OfferDetailBody
            key={`${item.coworkerName}-${item.offer.title}`}
            item={item}
            labels={labels}
            typeLabel={typeLabel ?? defaultTypeLabel}
            onStart={onStart}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function OfferDetailBody({
  item,
  labels,
  typeLabel,
  onStart,
}: {
  item: OfferDetailItem;
  labels: OfferDetailLabels;
  typeLabel: (type: OutputKind) => string;
  onStart: () => void;
}) {
  const { offer } = item;
  const outputs = offerOutputs(offer);
  const [activeIdx, setActiveIdx] = useState(0);
  const active = outputs[Math.min(activeIdx, outputs.length - 1)];

  return (
    <div className="flex max-h-[92dvh] flex-col overflow-y-auto md:grid md:h-[86dvh] md:max-h-none md:grid-cols-[1.7fr_1fr] md:overflow-hidden">
      {/* Preview */}
      <div className="bg-muted/30 md:border-border flex flex-col md:min-h-0 md:border-r">
        {outputs.length > 1 ? (
          <div className="border-border bg-background/70 flex gap-1.5 overflow-x-auto border-b p-2.5 backdrop-blur">
            {outputs.map((output, index) => (
              <button
                key={output.url ?? output.label ?? output.type}
                type="button"
                onClick={() => setActiveIdx(index)}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
                  FOCUS_RING,
                  index === activeIdx
                    ? "bg-foreground text-background"
                    : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <OutputTypeIcon type={output.type} className="size-3.5" />
                {output.label ?? typeLabel(output.type)}
              </button>
            ))}
          </div>
        ) : null}
        <div className="h-[46vh] md:h-auto md:min-h-0 md:flex-1">
          <OfferEmbed
            output={active}
            title={offer.title}
            pendingLabel={labels.pending ?? "Sample output"}
          />
        </div>
      </div>

      {/* Details */}
      <div className="md:min-h-0 md:overflow-y-auto">
        <div className="space-y-5 p-6">
          <div className="space-y-2 pr-10">
            <div className="flex flex-wrap items-center gap-2">
              {offer.category ? (
                <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                  {offer.category}
                </span>
              ) : null}
              <span className="border-border/60 text-muted-foreground inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium">
                <OutputTypeIcon type={active.type} className="size-3" />
                {active.label ?? typeLabel(active.type)}
              </span>
            </div>
            <DialogTitle className="text-foreground text-xl font-semibold text-balance">
              {offer.title}
            </DialogTitle>
            <DialogDescription className="text-foreground/80 text-sm leading-relaxed text-pretty">
              {offer.description ?? labels.fallbackTitle ?? offer.title}
            </DialogDescription>
          </div>

          {offer.deliverable ? (
            <div className="border-border/60 rounded-xl border p-4">
              <p className="text-muted-foreground mb-1 text-xs font-medium">
                {labels.deliverable ?? "Deliverable"}
              </p>
              <p className="text-foreground text-sm">{offer.deliverable}</p>
            </div>
          ) : null}

          <div>
            <p className="text-muted-foreground mb-2 text-xs font-medium">
              {labels.deliveredBy ?? "Delivered by"}
            </p>
            <div className="flex items-center gap-3">
              {item.coworkerAvatar}
              <div className="min-w-0 flex-1">
                <p className="text-foreground truncate text-sm font-medium">
                  {item.coworkerName}
                </p>
                {item.coworkerCaption ? (
                  <p className="text-muted-foreground truncate text-xs">
                    {item.coworkerCaption}
                  </p>
                ) : null}
              </div>
              {item.vendor ? (
                <VendorMark
                  vendor={item.vendor}
                  className="h-3.5 shrink-0"
                  textClassName="text-muted-foreground text-xs font-medium"
                />
              ) : null}
            </div>
            {item.metaTags ? <div className="mt-3">{item.metaTags}</div> : null}
          </div>

          <div className="flex flex-col gap-2">
            <Button type="button" onClick={onStart}>
              {labels.start}
              <ArrowRight aria-hidden className="size-4" />
            </Button>
            {active.url ? (
              <Button asChild variant="outline">
                <a href={active.url} target="_blank" rel="noreferrer">
                  {labels.openInNewTab ?? "Open in new tab"}
                  <ExternalLink aria-hidden className="size-4" />
                </a>
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
