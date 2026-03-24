"use client";

import { useCallback, useState } from "react";

import { cn } from "@/lib/utils";

export interface FaviconProps
  extends React.ImgHTMLAttributes<HTMLImageElement> {
  sources: string[];
  alt: string;
  /** Pixel size for width/height. Defaults to 32. */
  size?: number;
  /** Rendered after all candidate sources fail. */
  fallback?: React.ReactNode;
}

export function Favicon(props: FaviconProps) {
  const { sources, alt, size = 32, className, fallback = null, ...imgProps } =
    props;
  if (!sources?.length) return null;

  const sourcesKey = sources.join("|");
  return (
    <FaviconImageCycle
      key={sourcesKey}
      sources={sources}
      alt={alt}
      size={size}
      className={className}
      fallback={fallback}
      imgProps={imgProps}
    />
  );
}

interface FaviconImageCycleProps {
  sources: string[];
  alt: string;
  size: number;
  className?: string;
  fallback: React.ReactNode;
  imgProps: Omit<FaviconProps, "sources" | "alt" | "size" | "className">;
}

function FaviconImageCycle({
  sources,
  alt,
  size,
  className,
  fallback,
  imgProps,
}: FaviconImageCycleProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const { onError, ...restImgProps } = imgProps;
  const handleSourceFailure = useCallback(
    (attemptedIndex: number) => {
      setCurrentIndex((previousIndex) => {
        if (previousIndex !== attemptedIndex) return previousIndex;
        return attemptedIndex + 1;
      });
    },
    [setCurrentIndex],
  );
  const handleImageRef = useCallback(
    (element: HTMLImageElement | null) => {
      if (!element) return;

      // On full page refresh, the initial request can fail before hydration.
      // If so, the image is already complete with no natural size.
      if (element.complete && element.naturalWidth === 0) {
        handleSourceFailure(currentIndex);
      }
    },
    [currentIndex, handleSourceFailure],
  );
  const currentSource = sources[currentIndex];
  if (!currentSource) return <>{fallback}</>;

  return (
    <img
      ref={handleImageRef}
      src={currentSource}
      alt={alt}
      width={size}
      height={size}
      className={cn("object-contain", className)}
      onError={(e) => {
        onError?.(e);
        if (e.defaultPrevented) return;
        handleSourceFailure(currentIndex);
      }}
      {...restImgProps}
    />
  );
}


