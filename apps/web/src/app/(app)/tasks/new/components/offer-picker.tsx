"use client";

import { ArrowUpRight, Eye, PenLine } from "lucide-react";

import { OfferCard } from "@/components/agents/offer-card";
import type { CoworkerOffer } from "@/lib/types/coworker";
import { cn } from "@/lib/utils";

export interface OfferPickerLabels {
  /** Heading, with a "{name}" placeholder, e.g. "Ask {name} to…". */
  title: string;
  startFromScratch: string;
  startFromScratchHint: string;
  previewExample: string;
}

interface OfferPickerProps {
  name: string;
  offers: CoworkerOffer[];
  labels: OfferPickerLabels;
  /** Pre-fills the editor with the offer's prompt. */
  onPickOffer: (offer: CoworkerOffer) => void;
  /** Opens a preview of the offer's example output. */
  onPreviewOffer: (offer: CoworkerOffer) => void;
  /** Opens a blank editor. */
  onStartFromScratch: () => void;
}

const FOCUS_RING =
  "focus-visible:ring-primary/40 outline-none focus-visible:ring-2";
// Mirrors OfferCard's outer shell so "Start from scratch" is the exact same size.
const CARD_SHELL =
  "group bg-card border-border/60 flex flex-col overflow-hidden rounded-2xl border text-left transition-all duration-200 hover:border-primary hover:shadow-sm active:scale-[0.99]";

/** Ready-to-run task cards (reusing the agents-page OfferCard) plus an
 *  equal-sized "Start from scratch" card. Each task card has a preview button to
 *  view its example output without leaving the picker. */
export function OfferPicker({
  name,
  offers,
  labels,
  onPickOffer,
  onPreviewOffer,
  onStartFromScratch,
}: OfferPickerProps) {
  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-xs font-medium">
        {labels.title.replace("{name}", name)}
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        {/* Start from scratch — always first; same shell/border as an offer card. */}
        <button
          type="button"
          onClick={onStartFromScratch}
          className={cn(CARD_SHELL, FOCUS_RING)}
        >
          <div className="bg-muted/40 relative flex aspect-[16/10] items-center justify-center overflow-hidden border-b">
            <span className="bg-background/90 text-muted-foreground group-hover:text-primary flex size-10 items-center justify-center rounded-full shadow-sm transition-colors">
              <PenLine className="size-5" />
            </span>
          </div>
          <div className="flex flex-1 flex-col gap-3 p-4">
            <div className="space-y-1">
              <h3 className="text-foreground font-medium text-balance">
                {labels.startFromScratch}
              </h3>
              <p className="text-muted-foreground line-clamp-2 text-sm leading-relaxed text-pretty">
                {labels.startFromScratchHint}
              </p>
            </div>
            <div className="mt-auto flex items-center gap-2 pt-1">
              <ArrowUpRight
                aria-hidden
                className="text-muted-foreground group-hover:text-foreground ml-auto size-4 transition-colors"
              />
            </div>
          </div>
        </button>

        {offers.map((offer, index) => (
          <div key={`${offer.title}-${index}`} className="relative">
            <OfferCard offer={offer} onClick={() => onPickOffer(offer)} />
            <button
              type="button"
              aria-label={labels.previewExample}
              title={labels.previewExample}
              onClick={() => onPreviewOffer(offer)}
              className={cn(
                "bg-background/90 text-muted-foreground hover:text-foreground absolute top-3 right-3 z-10 flex size-7 items-center justify-center rounded-full shadow-sm backdrop-blur transition-colors",
                FOCUS_RING,
              )}
            >
              <Eye className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
