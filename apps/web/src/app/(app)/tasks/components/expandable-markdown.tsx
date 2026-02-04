"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import Markdown from "@/components/markdown";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const LINE_CLAMP_CLASSES: Record<number, string> = {
  1: "line-clamp-1",
  2: "line-clamp-2",
  3: "line-clamp-3",
  4: "line-clamp-4",
  5: "line-clamp-5",
  6: "line-clamp-6",
};

interface ExpandableMarkdownProps {
  content: string;
  className?: string;
  lineClamp?: number;
  expandLabel: string;
  collapseLabel: string;
  fadeClassName?: string;
}

export function ExpandableMarkdown({
  content,
  className,
  lineClamp = 5,
  expandLabel,
  collapseLabel,
  fadeClassName,
}: ExpandableMarkdownProps) {
  const [open, setOpen] = useState(false);
  const [isExpandable, setIsExpandable] = useState(false);
  const contentRef = useRef<HTMLDivElement | null>(null);

  const lineClampClass = useMemo(() => {
    return LINE_CLAMP_CLASSES[lineClamp] ?? LINE_CLAMP_CLASSES[5];
  }, [lineClamp]);

  useEffect(() => {
    const element = contentRef.current;
    if (!element || open) {
      return;
    }

    const measureOverflow = () => {
      const hasOverflow = element.scrollHeight > element.clientHeight + 1;
      setIsExpandable(hasOverflow);
    };

    measureOverflow();

    const observer = new ResizeObserver(measureOverflow);
    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [content, lineClampClass, open]);

  const shouldFade = !open && isExpandable;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="relative">
        <CollapsibleContent forceMount>
          <div
            ref={contentRef}
            className={cn(
              !open && "overflow-hidden",
              !open && lineClampClass,
              shouldFade &&
                "[mask-image:linear-gradient(to_bottom,black_60%,transparent_100%)] [-webkit-mask-image:linear-gradient(to_bottom,black_60%,transparent_100%)]",
            )}
          >
            <Markdown className={className}>{content}</Markdown>
          </div>
        </CollapsibleContent>

        {shouldFade ? (
          <div
            className={cn(
              "pointer-events-none absolute inset-x-0 bottom-0 flex h-12 items-end justify-center bg-gradient-to-b from-transparent",
              fadeClassName ?? "to-background",
            )}
          >
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant="outline"
                className="pointer-events-auto h-7 rounded-full px-3 text-xs font-semibold bg-background/80 backdrop-blur hover:bg-background"
              >
                {expandLabel}
              </Button>
            </CollapsibleTrigger>
          </div>
        ) : null}
      </div>

      {open && isExpandable ? (
        <div className="mt-2 flex justify-center">
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="outline"
              className="h-7 rounded-full px-3 text-xs font-semibold"
            >
              {collapseLabel}
            </Button>
          </CollapsibleTrigger>
        </div>
      ) : null}
    </Collapsible>
  );
}
