"use client";

import { Bot } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import {
  Carousel,
  CarouselContent,
  CarouselItem,
} from "@/components/ui/carousel";
import { cn } from "@/lib/utils";

/**
 * Mobile-only home carousel with "Search agents" as the last item.
 * Tapping it navigates to `/agents`.
 */
export function HomeCarousel(): React.ReactElement {
  const t = useTranslations("App.Channels.MobileNav");

  return (
    <div className="w-full px-4">
      <Carousel
        opts={{
          align: "start",
          loop: false,
        }}
        className="w-full"
      >
        <CarouselContent className="-ml-2">
          <CarouselItem className="basis-auto pl-2">
            <Link
              href="/agents"
              className={cn(
                "bg-card hover:bg-accent flex h-24 w-40 flex-col items-center justify-center gap-2 rounded-lg border p-4 transition-colors",
              )}
            >
              <Bot className="text-muted-foreground size-6" aria-hidden />
              <span className="text-foreground text-sm font-medium">
                {t("searchAgents")}
              </span>
            </Link>
          </CarouselItem>
        </CarouselContent>
      </Carousel>
    </div>
  );
}
