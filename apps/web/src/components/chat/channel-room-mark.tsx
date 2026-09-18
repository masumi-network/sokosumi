import type { ChatRoom } from "@/lib/clients/generated/core";
import { getInitials } from "@/lib/utils/text";
import {
  ChannelKindGlyph,
  channelKindIcon,
} from "./channel-discoverability-icon";

interface ChannelRoomMarkProps {
  room: Pick<ChatRoom, "name" | "discoverability">;
}

/**
 * Channel tile (see CONTEXT.md): the leading mark of a Channel row in the
 * sidebar. Expanded, the plain kind glyph beside the name. Collapsed to icons,
 * a 24px rounded square of the name's initials on the same muted fill a DM
 * avatar falls back to, with a lock or globe corner mark for a non-public kind.
 * Both are rendered and CSS picks one, the same way the row hides its trailing
 * controls when collapsed. Either way the mark sits in the row's
 * `SidebarRowSlot`, so glyph and tile share one centre line.
 */
export function ChannelRoomMark({
  room: { name, discoverability },
}: ChannelRoomMarkProps) {
  const CornerIcon = channelKindIcon(discoverability);

  return (
    <>
      <ChannelKindGlyph
        className="group-data-[collapsible=icon]:hidden"
        discoverability={discoverability}
      />
      <span
        data-slot="channel-tile"
        className="bg-muted text-foreground relative hidden size-6 shrink-0 items-center justify-center rounded-md text-[0.625rem] leading-none font-semibold group-data-[collapsible=icon]:inline-flex"
        aria-hidden
      >
        {getInitials(name)}
        {CornerIcon ? (
          <span className="bg-sidebar text-muted-foreground absolute -right-1.5 -bottom-1.5 inline-flex size-3 items-center justify-center rounded-full [&_svg]:size-2.5">
            <CornerIcon />
          </span>
        ) : null}
      </span>
    </>
  );
}
