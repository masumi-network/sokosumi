"use client";

import { useState } from "react";

import type { Coworker } from "@/app/chat/utils/types";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface CoworkerAvatarWithSkeletonProps {
  coworker: Coworker;
  getAvatarUrl: (c: Coworker) => string | null;
  className?: string;
  avatarClassName?: string;
}

export function CoworkerAvatarWithSkeleton({
  coworker,
  getAvatarUrl,
  className,
  avatarClassName,
}: CoworkerAvatarWithSkeletonProps) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const src = getAvatarUrl(coworker) ?? undefined;

  return (
    <span className={cn("relative inline-block shrink-0", className)}>
      {src && !imageLoaded && (
        <Skeleton className={cn("absolute inset-0 rounded-full", className)} />
      )}
      <Avatar
        className={cn(
          src && !imageLoaded && "opacity-0",
          className,
          avatarClassName,
        )}
      >
        <AvatarImage
          src={src}
          alt={coworker.name}
          onLoad={() => setImageLoaded(true)}
          onError={(e: React.SyntheticEvent<HTMLImageElement, Event>) => {
            e.currentTarget.style.display = "none";
            setImageLoaded(true);
          }}
        />
        <AvatarFallback className="bg-primary text-primary-foreground text-xs">
          {coworker.name.charAt(0).toUpperCase()}
        </AvatarFallback>
      </Avatar>
    </span>
  );
}
