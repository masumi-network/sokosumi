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
  /** One direct action, drawn above the card link so it never opens it. */
  action?: ReactNode;
}

// The name's link stretches over the whole card; the action sits above it.
const STRETCHED_LINK_CLASS =
  "text-foreground min-w-0 truncate font-medium outline-none after:absolute after:inset-0 after:rounded-[inherit] after:content-['']";

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
  action,
}: AgentTileProps) {
  return (
    <div
      className={cn(
        HOLDER_ITEM_CLASS,
        HOLDER_ITEM_HOVER_CLASS,
        "has-[a:focus-visible]:ring-ring relative flex h-full min-w-0 flex-col gap-3 p-4 has-[a:focus-visible]:ring-2",
        !action && "press",
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center">
          {avatar}
        </span>
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          {external ? (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className={STRETCHED_LINK_CLASS}
            >
              {name}
            </a>
          ) : (
            <Link href={href} className={STRETCHED_LINK_CLASS}>
              {name}
            </Link>
          )}
          {external ? (
            <ArrowUpRight
              aria-hidden
              className="text-muted-foreground size-4 shrink-0"
            />
          ) : null}
        </span>
        {status ? <span className="shrink-0 text-xs">{status}</span> : null}
      </div>
      <p className="text-muted-foreground line-clamp-2 text-sm text-pretty">
        {purpose}
      </p>
      <div className="text-muted-foreground mt-auto flex min-h-8 min-w-0 items-center justify-between gap-3 text-xs">
        <span className="flex min-w-0 items-center gap-1.5">{meta}</span>
        {action ? <div className="relative z-10 shrink-0">{action}</div> : null}
      </div>
    </div>
  );
}

/** The grid every Agents page section lays its tiles in. */
export const AGENT_TILE_GRID_CLASS =
  "grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(16rem,1fr))]";
