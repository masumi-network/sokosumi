"use client";

import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { useReducedMotion } from "motion/react";
import Image from "next/image";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
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
}: {
  template: StudioTemplate;
  label: string;
  onApplyTemplate: TemplatePickerProps["onApplyTemplate"];
  large?: boolean;
}) {
  return (
    <button
      className={cn(
        "bg-background hover:bg-card-background-hover focus-visible:ring-ring-halo flex cursor-pointer gap-2 rounded-xl text-left outline-none focus-visible:ring-[3px]",
        large
          ? "border-border w-full flex-col overflow-hidden border p-2"
          : "min-h-11 shrink-0 items-center p-1 pr-3",
      )}
      onClick={() => onApplyTemplate(template)}
      type="button"
    >
      <span
        className={cn(
          "bg-muted relative shrink-0 overflow-hidden rounded-lg",
          large ? "aspect-4/3 w-full" : "size-8",
        )}
      >
        <Image
          alt=""
          className="object-cover"
          fill
          sizes={
            large
              ? "(min-width: 1024px) 18rem, (min-width: 640px) 26rem, 75vw"
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

/** Synchronize rotation with Embla; choosing a brief always stays explicit. */
export function StudioTemplateCarousel({
  labels,
  onApplyTemplate,
}: TemplatePickerProps) {
  const [api, setApi] = useState<CarouselApi>();
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const reduceMotion = useReducedMotion();
  const rotationStopped = paused || !!reduceMotion;

  useEffect(() => {
    if (!api) return;
    const stop = () => setPaused(true);
    api.on("pointerDown", stop);
    return () => {
      api.off("pointerDown", stop);
    };
  }, [api]);

  useEffect(() => {
    if (!api || rotationStopped || hovered) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) api.scrollNext();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [api, rotationStopped, hovered]);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 py-4">
      <div className="space-y-2 px-4 text-center">
        <h2 className="text-xl font-medium">{labels.emptyTitle}</h2>
        <p className="text-muted-foreground text-sm text-pretty">
          {labels.emptyBody}
        </p>
      </div>
      <Carousel
        aria-label={labels.templates}
        className="flex min-w-0 flex-col"
        onFocusCapture={(event) => {
          // Focusing a choice stops rotation until explicitly restarted.
          if (
            !(event.target instanceof HTMLElement) ||
            !event.target.closest("[data-rotation-control]")
          )
            setPaused(true);
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        opts={{ loop: true, align: "center", duration: reduceMotion ? 0 : 25 }}
        setApi={setApi}
      >
        <div className="order-2 mt-4 flex items-center justify-center gap-2">
          {!reduceMotion ? (
            <Button
              aria-label={
                paused
                  ? labels.startTemplateRotation
                  : labels.pauseTemplateRotation
              }
              className="size-11"
              data-rotation-control
              onClick={() => setPaused((current) => !current)}
              size="icon"
              variant="ghost"
            >
              {paused ? (
                <Play aria-hidden className="size-4" />
              ) : (
                <Pause aria-hidden className="size-4" />
              )}
            </Button>
          ) : null}
          <Button
            aria-label={labels.previousTemplate}
            className="size-11"
            onClick={() => api?.scrollPrev()}
            size="icon"
            variant="outline"
          >
            <ChevronLeft aria-hidden className="size-4" />
          </Button>
          <Button
            aria-label={labels.nextTemplate}
            className="size-11"
            onClick={() => api?.scrollNext()}
            size="icon"
            variant="outline"
          >
            <ChevronRight aria-hidden className="size-4" />
          </Button>
        </div>
        <CarouselContent className="py-1">
          {STUDIO_TEMPLATES.map((template) => (
            <CarouselItem
              className="basis-3/4 sm:basis-1/2 lg:basis-1/3"
              key={template.id}
            >
              <TemplateButton
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
