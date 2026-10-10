"use client";

import { MousePointer2 } from "lucide-react";
import { useReducedMotion } from "motion/react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import {
  Carousel,
  type CarouselApi,
  CarouselContent,
  CarouselItem,
} from "@/components/ui/carousel";
import { cn } from "@/lib/utils";
import {
  collectStudioCarouselSlides,
  paintStudioCarouselDepth,
  type StudioCarouselSlide,
  setStudioCarouselDragging,
  studioCarouselRoot,
} from "./studio-carousel-paint";
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
          ? "border-border data-[studio-snap-target]:border-primary flex-col overflow-hidden border p-2 shadow-lg"
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
          decoding="async"
          fill
          loading="lazy"
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
  const reduceMotion = useReducedMotion();
  const apiRef = useRef(api);
  apiRef.current = api;
  const reduceMotionRef = useRef(!!reduceMotion);
  reduceMotionRef.current = !!reduceMotion;
  const slidesRef = useRef<StudioCarouselSlide[]>([]);
  const draggingRef = useRef(false);
  const focusedRef = useRef(false);
  const hoverDirectionRef = useRef<"previous" | "next" | null>(null);
  const hoverTimerRef = useRef(0);

  function stopHoverScroll() {
    if (hoverTimerRef.current) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = 0;
    }
  }

  function syncHoverScroll() {
    stopHoverScroll();
    const embla = apiRef.current;
    const direction = hoverDirectionRef.current;
    if (
      !embla ||
      draggingRef.current ||
      focusedRef.current ||
      reduceMotionRef.current ||
      !direction
    ) {
      return;
    }
    const tick = () => {
      if (
        document.hidden ||
        draggingRef.current ||
        focusedRef.current ||
        !hoverDirectionRef.current
      ) {
        return;
      }
      if (hoverDirectionRef.current === "previous") embla.scrollPrev();
      else embla.scrollNext();
      hoverTimerRef.current = window.setTimeout(tick, 1000);
    };
    hoverTimerRef.current = window.setTimeout(tick, 300);
  }

  function setHoverDirection(direction: "previous" | "next" | null) {
    if (hoverDirectionRef.current === direction) return;
    hoverDirectionRef.current = direction;
    syncHoverScroll();
  }

  useEffect(() => {
    if (!api) return;
    const slides = collectStudioCarouselSlides(api.slideNodes());
    slidesRef.current = slides;
    let frame = 0;
    const paintDepth = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        paintStudioCarouselDepth({
          viewport: api.rootNode().getBoundingClientRect(),
          slides,
          reduceMotion: !!reduceMotion,
        });
      });
    };
    paintDepth();
    api.on("scroll", paintDepth);
    api.on("reInit", paintDepth);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      api.off("scroll", paintDepth);
      api.off("reInit", paintDepth);
    };
  }, [api, reduceMotion]);

  useEffect(() => {
    if (!api) return;
    const root = studioCarouselRoot(api.rootNode());
    const startDrag = () => {
      draggingRef.current = true;
      stopHoverScroll();
      setStudioCarouselDragging(root, slidesRef.current, true);
    };
    const endDrag = () => {
      draggingRef.current = false;
      setStudioCarouselDragging(root, slidesRef.current, false);
      syncHoverScroll();
    };
    api.on("pointerDown", startDrag);
    api.on("pointerUp", endDrag);
    return () => {
      api.off("pointerDown", startDrag);
      api.off("pointerUp", endDrag);
      setStudioCarouselDragging(root, slidesRef.current, false);
    };
  }, [api]);

  useEffect(() => () => stopHoverScroll(), []);

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
        className="group relative flex min-w-0 flex-col"
        onFocusCapture={() => {
          focusedRef.current = true;
          stopHoverScroll();
        }}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            focusedRef.current = false;
            syncHoverScroll();
          }
        }}
        onMouseLeave={() => setHoverDirection(null)}
        opts={{ loop: true, align: "center", duration: reduceMotion ? 0 : 25 }}
        setApi={setApi}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-20 hidden bg-overlay-primary group-data-[studio-dragging]:block"
        />
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
