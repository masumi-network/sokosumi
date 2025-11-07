"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Carousel,
  type CarouselApi,
  CarouselContent,
} from "@/components/ui/carousel";
import { cn } from "@/lib/utils";

interface AgentCarouselProps {
  children: React.ReactNode;
  className?: string;
  itemCount: number;
  itemIds?: string[];
  title?: string;
}

function AgentCarousel({
  children,
  className,
  itemCount,
  itemIds,
  title,
}: AgentCarouselProps) {
  const [api, setApi] = useState<CarouselApi>();
  const [current, setCurrent] = useState(0);
  const [canScrollNext, setCanScrollNext] = useState(false);
  const [canScrollPrev, setCanScrollPrev] = useState(false);
  const carouselRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!api) {
      return;
    }

    const handleSelect = () => {
      setCurrent(api.selectedScrollSnap());
      setCanScrollNext(api.canScrollNext());
      setCanScrollPrev(api.canScrollPrev());
    };

    api.on("select", handleSelect);

    requestAnimationFrame(() => {
      handleSelect();
    });

    return () => {
      api.off("select", handleSelect);
    };
  }, [api]);

  useEffect(() => {
    const carouselElement = carouselRef.current;
    if (!carouselElement || !api) {
      return;
    }

    const handleWheel = (event: WheelEvent) => {
      // Only handle wheel events on desktop (md and above)
      const MD_BREAKPOINT = 768;
      if (window.innerWidth < MD_BREAKPOINT) {
        return;
      }

      // Check if this is primarily horizontal scroll (deltaX is significant)
      // and ignore if it's primarily vertical scroll
      const absDeltaX = Math.abs(event.deltaX);
      const absDeltaY = Math.abs(event.deltaY);

      // Only handle if horizontal scroll is significant and greater than vertical
      if (absDeltaX > absDeltaY && api) {
        event.preventDefault();
        if (event.deltaX > 0) {
          api.scrollNext();
        } else {
          api.scrollPrev();
        }
      }
      // Otherwise, let the event pass through for normal page scrolling
    };

    carouselElement.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      carouselElement.removeEventListener("wheel", handleWheel);
    };
  }, [api]);

  return (
    <div className={cn("w-full", className)}>
      {/* Desktop Header with Title and Arrows */}
      {title && (
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-light md:text-2xl">{title}</h2>
          {itemCount > 1 && api && (canScrollNext || canScrollPrev) && (
            <div className="hidden items-center gap-2 md:flex">
              <Button
                type="button"
                variant="secondary"
                size="icon"
                onClick={() => api?.scrollPrev()}
                aria-label="Scroll to previous"
                disabled={!canScrollPrev}
                className={cn(
                  "text-secondary rounded-full border bg-transparent transition-opacity duration-300",
                  canScrollPrev ? "opacity-100" : "opacity-50",
                )}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="icon"
                onClick={() => api?.scrollNext()}
                aria-label="Scroll to next"
                disabled={!canScrollNext}
                className={cn(
                  "text-secondary rounded-full border bg-transparent transition-opacity duration-300",
                  canScrollNext ? "opacity-100" : "opacity-50",
                )}
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          )}
        </div>
      )}
      <div ref={carouselRef} className="relative">
        <Carousel
          setApi={setApi}
          className="w-full"
          opts={{
            align: "start",
          }}
        >
          <CarouselContent className="pt-2">{children}</CarouselContent>
        </Carousel>
      </div>
      {/* Dots Indicator - Mobile Only */}
      {itemCount > 1 && (
        <div className="mt-4 flex justify-center gap-2 md:hidden">
          {Array.from({ length: itemCount }).map((_, index) => {
            const key = itemIds?.[index] ?? index;
            return (
              <button
                key={key}
                type="button"
                aria-label={`Go to slide ${index + 1}`}
                onClick={() => api?.scrollTo(index)}
                className={cn(
                  "size-2 rounded-full transition-all",
                  current === index ? "bg-primary" : "bg-muted-foreground/30",
                )}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

export { AgentCarousel };
