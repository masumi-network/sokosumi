"use client";

import { ChevronDown } from "lucide-react";
import type { ComponentType, ReactNode, SVGProps } from "react";

import { CollapsibleTrigger } from "@/components/ui/collapsible";
import { SidebarMenuButton } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { RailAttentionPill } from "./chat-room-sidebar-row";
import type { SectionAttention } from "./room-attention";

/**
 * Collapsible section heading for the chat sidebar (Channels, External,
 * Archived, Direct Messages).
 *
 * The trailing padding steps with how many action controls sit in the
 * absolutely-positioned trailing slot, so a long section title truncates
 * before it runs under them.
 *
 * A section with a `railIcon` keeps its heading on the collapsed rail, as the
 * same 32px square every rail item is: the icon names the section, the
 * tooltip spells it out, and pressing it opens or closes the section there
 * too. It stands where the expanded heading's 32px row stood, so the rooms
 * under it keep their place when the sidebar toggles, and it marks where one
 * section ends and the next begins. Both headings are rendered and CSS picks
 * one, the same way a Channel row carries its glyph and its tile.
 *
 * A closed section hides its rooms, and with them whatever they held for the
 * reader. `closedAttention` says so on the heading: the row's own bold on the
 * expanded title, the Rail attention pill beside the rail square. An open
 * section passes none, because its rooms speak for themselves.
 */
export function ChatSidebarSectionHeader({
  children,
  isOpen,
  railIcon: RailIcon,
  closedAttention = null,
  createAction,
  secondaryAction,
}: {
  children: ReactNode;
  isOpen: boolean;
  railIcon?: ComponentType<SVGProps<SVGSVGElement>>;
  closedAttention?: SectionAttention;
  createAction?: ReactNode;
  secondaryAction?: ReactNode;
}) {
  const trailingCount = (secondaryAction ? 1 : 0) + (createAction ? 1 : 0);
  const attention = isOpen ? null : closedAttention;

  return (
    <>
      <div className="group-data-[collapsible=icon]:hidden relative flex h-10 items-center gap-1 px-3 md:h-8">
        <CollapsibleTrigger
          className={cn(
            "text-muted-foreground hover:text-foreground flex min-w-0 flex-1 items-center gap-1 rounded-md text-left text-base font-medium transition-colors md:text-xs",
            attention && "text-foreground font-semibold",
            trailingCount === 1 && "pr-9",
            trailingCount >= 2 && "pr-16",
            trailingCount === 0 && "md:pr-0",
            trailingCount === 1 && "md:pr-8",
            trailingCount >= 2 && "md:pr-14",
          )}
        >
          <ChevronDown
            aria-hidden
            className={cn(
              "size-4 shrink-0 transition-transform md:size-3",
              !isOpen && "-rotate-90",
            )}
          />
          <span className="truncate">{children}</span>
        </CollapsibleTrigger>
        {trailingCount > 0 ? (
          <div className="absolute top-1/2 right-1 flex -translate-y-1/2 items-center">
            {secondaryAction}
            {createAction}
          </div>
        ) : null}
      </div>
      {RailIcon ? (
        <div
          data-slot="section-rail-header"
          className="relative hidden group-data-[collapsible=icon]:block"
        >
          {attention ? <RailAttentionPill variant={attention} /> : null}
          <SidebarMenuButton
            asChild
            tooltip={{ children }}
            // `isOpen`, not `data-[state=closed]`: the tooltip trigger writes
            // its own `data-state` onto this same button and wins.
            className={cn("text-muted-foreground", !isOpen && "opacity-60")}
          >
            <CollapsibleTrigger>
              <RailIcon aria-hidden />
              <span className="sr-only">{children}</span>
            </CollapsibleTrigger>
          </SidebarMenuButton>
        </div>
      ) : null}
    </>
  );
}
