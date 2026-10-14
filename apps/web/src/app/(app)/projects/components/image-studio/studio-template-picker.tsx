"use client";

import { MousePointer2 } from "lucide-react";
import { useReducedMotion } from "motion/react";
import Image from "next/image";
import { useEffect, useState } from "react";
import {
  Carousel,
  type CarouselApi,
  CarouselContent,
  CarouselItem,
} from "@/components/ui/carousel";
import { cn } from "@/lib/utils";
import { STUDIO_TEMPLATES, type StudioTemplate } from "./studio-templates";
import type { StudioLabels } from "./types";

type TemplatePickerProps = {
  labels: StudioLabels;
  onApplyTemplate: (template: StudioTemplate) => void;
};

function TemplateButton({
  template,
  label,
  onApplyTemplate,
  large = false,
  dimensional = false,
}: {
  template: StudioTemplate;
  label: string;
  onApplyTemplate: TemplatePickerProps["onApplyTemplate"];
  large?: boolean;
  dimensional?: boolean;
}) {
  return (
    <button
      className={cn(
        "bg-background hover:bg-card-background-hover focus-visible:ring-ring-halo flex cursor-pointer gap-2 rounded-xl text-left outline-none focus-visible:ring-[3px]",
        large
          ? "border-border flex-col overflow-hidden border p-2"
          : "min-h-11 shrink-0 items-center p-1 pr-3",
        large && (dimensional ? "relative left-1/2 w-48 sm:w-56" : "w-full"),
      )}
      data-template-card={large || undefined}
      onClick={() => onApplyTemplate(template)}
      type="button"
    >
      <span
        data-template-preview
        className={cn(
          "bg-muted relative shrink-0 overflow-hidden rounded-lg",
          large
            ? dimensional
              ? "aspect-3/4 w-full"
              : "aspect-4/3 w-full"
            : "size-8",
        )}
      >
        <Image
          alt=""
          className="object-cover"
          fill
          sizes={
            large
              ? dimensional
                ? "(min-width: 640px) 14rem, 12rem"
                : "(min-width: 1024px) 18rem, (min-width: 640px) 26rem, 75vw"
              : "2rem"
          }
          src={`/studio/templates/${template.id}.jpg`}
        />
      </span>
      <span
        className={
          large ? "px-1 py-1 text-sm font-medium" : "text-xs font-medium"
        }
      >
        {label}
      </span>
    </button>
  );
}

/** The same starting briefs, beside the composer once there are results. */
export function StudioTemplateStrip({
  labels,
  onApplyTemplate,
}: TemplatePickerProps) {
  return (
    <div
      aria-label={labels.templates}
      className="app-scrollbar flex gap-2 overflow-x-auto p-1"
      role="group"
    >
      {STUDIO_TEMPLATES.map((template) => (
        <TemplateButton
          key={template.id}
          label={labels.templateLabels[template.id]}
          onApplyTemplate={onApplyTemplate}
          template={template}
        />
      ))}
    </div>
  );
}

/** Navigate with drag, arrow keys, or edge hover; choosing a brief stays explicit. */
export function StudioTemplateCarousel({
  labels,
  onApplyTemplate,
}: TemplatePickerProps) {
  const [api, setApi] = useState<CarouselApi>();
  const [dragging, setDragging] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hoverDirection, setHoverDirection] = useState<
    "previous" | "next" | null
  >(null);
  const reduceMotion = useReducedMotion();
  const scrollingStopped = dragging || focused || !!reduceMotion;

  useEffect(() => {
    if (!api) return;
    const paintDepth = () => {
      const viewport = api.rootNode().getBoundingClientRect();
      const center = viewport.left + viewport.width / 2;
      for (const slide of api.slideNodes()) {
        const card = slide.querySelector<HTMLElement>("[data-template-card]");
        const preview = slide.querySelector<HTMLElement>(
          "[data-template-preview]",
        );
        if (!card || !preview) continue;
        if (reduceMotion) {
          card.style.transform = "";
          preview.style.filter = "";
          preview.style.opacity = "";
          slide.style.zIndex = "";
          continue;
        }
        const bounds = slide.getBoundingClientRect();
        if (!bounds.width) continue;
        const offset = (bounds.left + bounds.width / 2 - center) / bounds.width;
        const distance = Math.min(Math.abs(offset), 3);
        card.style.transform = `translateX(-50%) perspective(1000px) translateZ(${80 - distance * 40}px) rotateY(${-offset * 8}deg) rotateZ(${offset * 3}deg) scale(${1 - distance * 0.1})`;
        preview.style.filter = `blur(${Math.max(0, distance - 1) * 1.5}px)`;
        preview.style.opacity = String(1 - distance * 0.15);
        slide.style.zIndex = String(20 - Math.round(distance * 5));
      }
    };
    paintDepth();
    api.on("scroll", paintDepth);
    api.on("reInit", paintDepth);
    return () => {
      api.off("scroll", paintDepth);
      api.off("reInit", paintDepth);
    };
  }, [api, reduceMotion]);

  useEffect(() => {
    if (!api) return;
    const startDrag = () => setDragging(true);
    const endDrag = () => setDragging(false);
    api.on("pointerDown", startDrag);
    api.on("pointerUp", endDrag);
    return () => {
      api.off("pointerDown", startDrag);
      api.off("pointerUp", endDrag);
    };
  }, [api]);

  useEffect(() => {
    if (!api || scrollingStopped || !hoverDirection) return;
    // Give a passing pointer time to select a card before starting navigation.
    let timer: number;
    const scroll = () => {
      if (!document.hidden) {
        if (hoverDirection === "previous") api.scrollPrev();
        else api.scrollNext();
      }
      timer = window.setTimeout(scroll, 1000);
    };
    timer = window.setTimeout(scroll, 300);
    return () => window.clearTimeout(timer);
  }, [api, scrollingStopped, hoverDirection]);

  return (
    <div className="w-full space-y-5 py-4">
      <div className="space-y-2 px-4 text-center">
        <h2 className="text-xl font-medium">{labels.emptyTitle}</h2>
        <p className="text-muted-foreground flex items-center justify-center gap-2 text-sm text-pretty">
          <MousePointer2 aria-hidden className="size-4 shrink-0" />
          <span>{labels.emptyBody}</span>
        </p>
      </div>
      <Carousel
        aria-label={labels.templates}
        className="flex min-w-0 flex-col"
        onFocusCapture={() => setFocused(true)}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget))
            setFocused(false);
        }}
        onMouseLeave={() => setHoverDirection(null)}
        opts={{ loop: true, align: "center", duration: reduceMotion ? 0 : 25 }}
        setApi={setApi}
      >
        <CarouselContent
          className={reduceMotion ? "py-1" : "items-center py-10"}
          onMouseLeave={() => setHoverDirection(null)}
          onMouseMove={(event) => {
            const item =
              event.target instanceof Element
                ? event.target.closest("[data-slot=carousel-item]")
                : null;
            const viewport = event.currentTarget.parentElement;
            if (!item || !viewport) {
              setHoverDirection(null);
              return;
            }
            const bounds = viewport.getBoundingClientRect();
            const card = item.getBoundingClientRect();
            const center = bounds.left + bounds.width / 2;
            setHoverDirection(
              card.right <= center
                ? "previous"
                : card.left >= center
                  ? "next"
                  : null,
            );
          }}
        >
          {STUDIO_TEMPLATES.map((template) => (
            <CarouselItem
              className={cn(
                "relative",
                reduceMotion
                  ? "basis-3/4 sm:basis-1/2 lg:basis-1/3"
                  : "basis-1/3 pl-0! sm:basis-1/5",
              )}
              key={template.id}
            >
              <TemplateButton
                dimensional={!reduceMotion}
                label={labels.templateLabels[template.id]}
                large
                onApplyTemplate={onApplyTemplate}
                template={template}
              />
            </CarouselItem>
          ))}
        </CarouselContent>
      </Carousel>
    </div>
  );
}
