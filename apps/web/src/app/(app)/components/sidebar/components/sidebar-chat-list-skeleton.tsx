import type { ReactNode } from "react";
import {
  SIDEBAR_RAIL_SQUARE_CLASS,
  SIDEBAR_ROW_CLASS,
  SIDEBAR_ROW_LABEL_CLASS,
  SIDEBAR_ROW_RAIL_PAD_CLASS,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarRowSlot,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Placeholder rooms for `OrganizationChatList`, built from the same sidebar
 * primitives the real list uses so the rail's `group-data-[collapsible=icon]`
 * rules apply to it for free.
 *
 * Both states are answered, because the rail is not a narrower version of the
 * panel: the section header becomes one 32px square and each row keeps only
 * its leading mark, on the same 28px axis every rail item uses (`pl-1`, not
 * `justify-center`, so a shrinking name cannot drag the mark). A full-width
 * bar in a 56px rail is the shape nothing on this sidebar has.
 *
 * It stands in for the two sections every reader has — Channels and Direct
 * Messages — rather than one anonymous stack, because those two are the only
 * ones that are always there: Pinned, External and Archived each depend on
 * data this frame has not loaded, and a section that appeared and then went
 * away would move every row under it. Two headings also put the list's one
 * landmark, the break between sections, where it will really land.
 *
 * The marks are the two a room row actually draws, and they differ by state
 * exactly as the real ones do (Channel tile, CONTEXT.md): a Channel is a 16px
 * kind glyph beside its name and a 24px tile on the rail, a Direct is a 24px
 * face in both, with a group Direct's second face growing its slot to the
 * right and dropping off the rail. A 24px square in the expanded panel — what
 * this used to draw for every row — is a mark no expanded row has.
 */

/**
 * Ragged name lengths, so the panel reads as a list of rooms rather than a
 * stack of identical bars. Doubles as the key: the widths are distinct within
 * each section.
 */
const CHANNEL_NAME_WIDTHS = ["w-24", "w-16", "w-32"] as const;

/**
 * One group Direct among the 1:1s, which is the mix a reader's list has and
 * the only row whose slot is wider than 24px.
 */
const DIRECT_ROWS = [
  { nameWidth: "w-20", faces: 1 },
  { nameWidth: "w-28", faces: 2 },
  { nameWidth: "w-14", faces: 1 },
] as const;

/**
 * A section heading's box: a titled row expanded, the section's 32px icon
 * square on the rail. Its create and browse controls are left out — they are
 * chrome that arrives with the real heading, and a grey square standing in
 * for a `+` reads as content that never comes.
 */
function SectionHeaderSkeleton({ titleWidth }: { titleWidth: string }) {
  return (
    <div
      className={cn(
        SIDEBAR_ROW_CLASS,
        SIDEBAR_RAIL_SQUARE_CLASS,
        SIDEBAR_ROW_RAIL_PAD_CLASS,
      )}
    >
      <SidebarRowSlot>
        <Skeleton className="size-4 md:size-3 group-data-[collapsible=icon]:size-4" />
      </SidebarRowSlot>
      <Skeleton
        className={cn(SIDEBAR_ROW_LABEL_CLASS, "h-3 flex-none", titleWidth)}
      />
    </div>
  );
}

/**
 * The row shape a real row takes from the primitive, so the skeleton cannot
 * drift from the list it stands in for.
 */
function RoomRowSkeleton({
  mark,
  nameWidth,
}: {
  mark: ReactNode;
  nameWidth: string;
}) {
  return (
    <SidebarMenuItem>
      <div
        className={cn(
          SIDEBAR_ROW_CLASS,
          SIDEBAR_RAIL_SQUARE_CLASS,
          SIDEBAR_ROW_RAIL_PAD_CLASS,
        )}
      >
        <SidebarRowSlot>{mark}</SidebarRowSlot>
        <Skeleton
          className={cn(SIDEBAR_ROW_LABEL_CLASS, "h-3 flex-none", nameWidth)}
        />
      </div>
    </SidebarMenuItem>
  );
}

/** `ChannelRoomMark`'s two shapes: the kind glyph, then the Channel tile. */
function ChannelMarkSkeleton() {
  return (
    <>
      <Skeleton className="group-data-[collapsible=icon]:hidden size-4" />
      <Skeleton className="hidden size-6 group-data-[collapsible=icon]:block" />
    </>
  );
}

/** `DirectRoomAvatarStack`: round faces, the first alone on the rail. */
function DirectMarkSkeleton({ faces }: { faces: number }) {
  return (
    <span className="inline-flex shrink-0 items-center">
      {Array.from({ length: faces }, (_, index) => (
        <Skeleton
          key={index}
          className={cn(
            "border-sidebar size-6 shrink-0 rounded-full border",
            index > 0 && "group-data-[collapsible=icon]:hidden -ml-2",
          )}
        />
      ))}
    </span>
  );
}

export function SidebarChatListSkeleton() {
  return (
    <SidebarGroup className="w-full" aria-hidden>
      <SidebarGroupContent className="space-y-2">
        <SectionHeaderSkeleton titleWidth="w-16" />
        <SidebarMenu className="gap-0">
          {CHANNEL_NAME_WIDTHS.map((nameWidth) => (
            <RoomRowSkeleton
              key={nameWidth}
              mark={<ChannelMarkSkeleton />}
              nameWidth={nameWidth}
            />
          ))}
        </SidebarMenu>
        <SectionHeaderSkeleton titleWidth="w-24" />
        <SidebarMenu className="gap-0">
          {DIRECT_ROWS.map(({ nameWidth, faces }) => (
            <RoomRowSkeleton
              key={nameWidth}
              mark={<DirectMarkSkeleton faces={faces} />}
              nameWidth={nameWidth}
            />
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
