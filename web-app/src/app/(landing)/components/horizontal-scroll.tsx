"use client";

import type React from "react";

import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";

interface HorizontalScrollProps {
  children: React.ReactNode;
}

export default function HorizontalScroll({ children }: HorizontalScrollProps) {
  return (
    <ScrollArea className="w-full whitespace-nowrap">
      <div className="flex h-full w-full justify-center gap-6 px-6 [&:not(:has(>*:nth-child(2)))]:justify-center">
        {children}
      </div>
      <ScrollBar orientation="horizontal" className="hidden" />
    </ScrollArea>
  );
}
