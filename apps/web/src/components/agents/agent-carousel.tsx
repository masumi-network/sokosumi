"use client";

import { useEffect, useRef, useState } from "react";

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
}

function AgentCarousel({
  children,
  className,
  itemCount,
  itemIds,
}: AgentCarouselProps) {
  const [api, setApi] = useState<CarouselApi>();
  const [current, setCurrent] = useState(0);
  const carouselRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!api) {
      return;
    }

    const handleSelect = () => {
      setCurrent(api.selectedScrollSnap());
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
      <div ref={carouselRef}>
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
