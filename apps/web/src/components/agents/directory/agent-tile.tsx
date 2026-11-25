import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import {
  HOLDER_ITEM_CLASS,
  HOLDER_ITEM_HOVER_CLASS,
} from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";

export interface AgentTileProps {
  href: string;
  /** Opens off Sokosumi in a new tab (an x402 agent's own page). */
  external?: boolean;
  avatar: ReactNode;
  name: string;
  purpose: string | null;
  /** Who it belongs to, its vendor, or its price. */
  meta: ReactNode;
  status?: ReactNode;
}

/**
 * The one card of the Agents page: Soko Bots, Coworkers and marketplace
 * agents all show an avatar, a name, one line of purpose and one meta line.
 */
export function AgentTile({
  href,
  external = false,
  avatar,
  name,
  purpose,
  meta,
  status,
}: AgentTileProps) {
  const className = cn(
    HOLDER_ITEM_CLASS,
    HOLDER_ITEM_HOVER_CLASS,
    "press focus-visible:ring-ring flex h-full min-w-0 flex-col gap-3 p-4 outline-none focus-visible:ring-2",
  );
  const body = (
    <>
      <span className="flex min-w-0 items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center">
          {avatar}
        </span>
        <span className="text-foreground min-w-0 flex-1 truncate font-medium">
          {name}
        </span>
        {external ? (
          <ArrowUpRight
            aria-hidden
            className="text-muted-foreground size-4 shrink-0"
          />
        ) : null}
      </span>
      <span className="text-muted-foreground line-clamp-2 text-sm text-pretty">
        {purpose}
      </span>
      <span className="text-muted-foreground mt-auto flex min-w-0 items-center justify-between gap-3 text-xs">
        <span className="min-w-0 truncate">{meta}</span>
        {status}
      </span>
    </>
  );

  if (external) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
      >
        {body}
      </a>
    );
  }
  return (
    <Link href={href} className={className}>
      {body}
    </Link>
  );
}

/** The grid every Agents page section lays its tiles in. */
export const AGENT_TILE_GRID_CLASS =
  "grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(16rem,1fr))]";
