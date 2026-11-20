"use client";

import dynamic from "next/dynamic";
import { cn } from "@/lib/utils";
import type { LiveBotAvatarProps } from "./live-bot-avatar.client";

/**
 * The live avatar carries the 16 traced animals (about 230 KB), so it loads on demand and only
 * in the browser. Until it arrives, the server-rendered picture stands in.
 */
const LazyLiveBotAvatar = dynamic<LiveBotAvatarProps>(
  () => import("./live-bot-avatar.client"),
  {
    ssr: false,
    loading: () => null,
  },
);

/** A live avatar with its still picture underneath, so nothing is empty while the chunk loads. */
export function LiveBotAvatarLazy({ className, ...props }: LiveBotAvatarProps) {
  return (
    <span className={cn("relative block shrink-0", className)}>
      <span className="bg-muted absolute inset-0 overflow-hidden rounded-full">
        {props.imageUrl ? (
          <img
            src={props.imageUrl}
            alt={props.alt ?? ""}
            className="size-full object-cover"
          />
        ) : null}
      </span>
      <LazyLiveBotAvatar
        {...props}
        alt=""
        className="absolute inset-0 size-full"
      />
    </span>
  );
}
