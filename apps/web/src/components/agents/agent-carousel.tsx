"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRef, useState } from "react";

import { ResolverSVGIcon } from "@/components/agents/resolver-svg-icon";
import { Button } from "@/components/ui/button";
import {
  Carousel,
  type CarouselApi,
  CarouselContent,
} from "@/components/ui/carousel";
import { useAgentCarouselHorizontalWheel } from "@/hooks/effects/use-agent-carousel-horizontal-wheel";
import { useAgentCarouselSelection } from "@/hooks/effects/use-agent-carousel-selection";
import { cn } from "@/lib/utils";

interface AgentCarouselProps {
  children: React.ReactNode;
  className?: string;
  icon?: string;
  itemCount: number;
  itemIds?: string[];
  title?: string;
}

function AgentCarousel({
  children,
  className,
  icon,
  itemCount,
  itemIds,
  title,
}: AgentCarouselProps) {
  const [api, setApi] = useState<CarouselApi>();
  const carouselRef = useRef<HTMLDivElement>(null);

  const { current, canScrollNext, canScrollPrev } =
    useAgentCarouselSelection(api);

  useAgentCarouselHorizontalWheel(carouselRef, api);

  return (
    <div className={cn("w-full", className)}>
      {/* Desktop Header with Title and Arrows */}
      {title && (
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-foreground flex items-center gap-2 text-base font-semibold">
            {icon && (
              <ResolverSVGIcon
                svgUrl={icon}
                alt={`${title} icon`}
                className="size-4 md:size-5"
              />
            )}
            {title}
          </h2>
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
                  "size-2 rounded-full transition-colors",
                  current === index ? "bg-foreground" : "bg-quaternary",
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
