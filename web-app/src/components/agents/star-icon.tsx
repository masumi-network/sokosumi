"use client";

import { useTheme } from "next-themes";
import { useId } from "react";

import { cn } from "@/lib/utils";

interface StarIconProps {
  fillPercentage: number; // 0-100
  size?: "xs" | "sm" | "md" | "lg";
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
    xs: "size-2", // 8px
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
        d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"
        fill={`url(#${gradientId})`}
      />
    </svg>
  );
}
