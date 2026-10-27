import type { ReactNode } from "react";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarRowSlot,
} from "@/components/ui/sidebar";
import {
  SIDEBAR_ROW_CLASS,
  SIDEBAR_ROW_LABEL_CLASS,
} from "@/components/ui/sidebar-classes";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Placeholder rooms for `OrganizationChatList`, built from the same sidebar
 * primitives the real list uses so its rows take the same shape.
 *
 * It stands in for the two sections a reader in an organization has — Channels
 * and Direct Messages — rather than one anonymous stack, because those two are
 * the only ones the real list always draws: Pinned, External and Archived each
 * depend on data this frame has not loaded, and a section that appeared and
 * then went away would move every row under it. Two headings also put the
 * list's one landmark, the break between sections, where it will really land.
 *
 * Channels is the one section that is not always there: the real list gates it
 * on `hasOrganization`, so a personal workspace has Directs alone. A caller
 * that knows which it is says so, and then the swap moves nothing there
 * either. The boot shell has no session yet and so cannot know, which is what
 * the default answers — the same call the row counts make.
 *
 * The marks are the two a room row actually draws: a Channel is a 16px kind
 * glyph beside its name, a Direct is a 20px face, with a group Direct's second
 * face growing its slot to the right. A 24px square — what this used to draw
 * for every row — is a mark no row has.
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
 * A section heading's box: a titled row. Its create and browse controls are
 * left out — they are chrome that arrives with the real heading, and a grey
 * square standing in for a `+` reads as content that never comes.
 */
function SectionHeaderSkeleton({ titleWidth }: { titleWidth: string }) {
  return (
    <div className={SIDEBAR_ROW_CLASS}>
      <SidebarRowSlot>
        <Skeleton className="size-4 md:size-3" />
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
      <div className={SIDEBAR_ROW_CLASS}>
        <SidebarRowSlot>{mark}</SidebarRowSlot>
        <Skeleton
          className={cn(SIDEBAR_ROW_LABEL_CLASS, "h-3 flex-none", nameWidth)}
        />
      </div>
    </SidebarMenuItem>
  );
}

/** `ChannelKindGlyph`: the kind glyph, at the size the row slot gives it. */
function ChannelMarkSkeleton() {
  return <Skeleton className="size-4 md:size-3.5" />;
}

/** `DirectRoomAvatarStack`: overlapping round faces. */
function DirectMarkSkeleton({ faces }: { faces: number }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center",
        // The stack's 2px axis padding, same as the real mark's.
        faces > 1 && "pl-0.5",
      )}
    >
      {Array.from({ length: faces }, (_, index) => (
        <Skeleton
          key={index}
          className={cn(
            "border-sidebar size-5 shrink-0 rounded-full border",
            index > 0 && "-ml-1.5",
          )}
        />
      ))}
    </span>
  );
}

export function SidebarChatListSkeleton({
  /** False for a personal workspace, whose real list has no Channels. */
  hasOrganization = true,
}: {
  hasOrganization?: boolean;
} = {}) {
  return (
    <SidebarGroup className="w-full" aria-hidden>
      <SidebarGroupContent className="space-y-2">
        {hasOrganization ? (
          <>
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
          </>
        ) : null}
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
