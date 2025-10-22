"use client";

import { useTheme } from "next-themes";
import { useId } from "react";

import { cn } from "@/lib/utils";

interface StarIconProps {
  fillPercentage: number; // 0-100
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function StarIcon({
  fillPercentage,
  size = "md",
  className,
}: StarIconProps) {
  // Generate stable unique gradient ID (prevents hydration mismatches)
  const uniqueId = useId();
  const gradientId = `star-gradient-${uniqueId}`;
  const { resolvedTheme } = useTheme();

  // Theme-aware colors
  const isDark = resolvedTheme === "dark";
  const filledColor = isDark ? "rgb(250, 250, 250)" : "rgb(10, 10, 10)";
  const emptyColor = isDark
    ? "rgba(255, 255, 255, 0.15)"
    : "rgb(230, 230, 230)";

  const sizeMap = {
    sm: "size-3", // 12px
    md: "size-4", // 16px
    lg: "size-5", // 20px
  };

  return (
    <svg
      viewBox="0 0 24 24"
      className={cn(sizeMap[size], className)}
      fill="none"
    >
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset={`${fillPercentage}%`} stopColor={filledColor} />
          <stop offset={`${fillPercentage}%`} stopColor={emptyColor} />
        </linearGradient>
      </defs>
      <path
        d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
        fill={`url(#${gradientId})`}
      />
    </svg>
  );
}
