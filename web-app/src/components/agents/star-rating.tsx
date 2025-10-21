"use client";

import { cn } from "@/lib/utils";

interface StarProps {
  fillPercentage: number; // 0-100
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function StarRating({
  fillPercentage,
  size = "md",
  className,
}: StarProps) {
  // Generate unique gradient ID to avoid conflicts
  const gradientId = `star-gradient-${Math.random().toString(36).substr(2, 9)}`;

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
      stroke="currentColor"
      strokeWidth="1"
    >
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop
            offset={`${fillPercentage}%`}
            stopColor="rgb(250 204 21)" // yellow-400
          />
          <stop
            offset={`${fillPercentage}%`}
            stopColor="rgb(163 163 163)" // muted-foreground
          />
        </linearGradient>
      </defs>
      <path
        d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
        fill={`url(#${gradientId})`}
      />
    </svg>
  );
}
