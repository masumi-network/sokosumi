import type { ReactNode, Ref } from "react";

import { CHAT_MESSAGE_LIST_ROOM } from "@/app/chat/chat-message-list";
import { CHAT_MESSAGE_LIST_SCROLLER_CLASS } from "@/app/chat/chat-message-list-scroller";
import { CHAT_MOBILE_HEIGHT_SHELL_NO_TAB_BAR_CLASS } from "@/app/chat/components/chat-mobile-tab-registry";
import {
  ROOM_CONTENT_COLUMN_CLASSNAME,
  ROOM_MESSAGE_LIST_CONTENT_CLASSNAME,
} from "@/app/chat/components/room-message-list-skeleton";
import { useRoomColumnSlide } from "@/app/chat/components/use-room-column-slide";
import { cn } from "@/lib/utils";

/** Root height for open room (no mobile tab bar). Instant + live must match. */
export const ROOM_SHELL_ROOT_CLASSNAME = cn(
  "-m-4 flex min-h-0 min-w-0 flex-col overflow-hidden bg-background",
  CHAT_MOBILE_HEIGHT_SHELL_NO_TAB_BAR_CLASS,
);

/** `@container`: the room content column reads the whole pane as `100cqw`. */
export const ROOM_SHELL_MAIN_CLASSNAME =
  "@container relative flex min-h-0 min-w-0 flex-1 overflow-x-clip";

export const ROOM_SHELL_SECTION_CLASSNAME =
  "flex min-h-0 min-w-0 flex-1 flex-col";

/** Column that holds desktop header + scroller + composer. */
export const ROOM_SHELL_COLUMN_CLASSNAME =
  "flex min-h-0 min-w-0 flex-1 flex-col";

/** The rule spans the pane; its contents ride the reading column. */
export const ROOM_SHELL_DESKTOP_HEADER_CLASSNAME =
  "flex h-16 shrink-0 border-b";

/**
 * The header's row, in `ROOM_CONTENT_COLUMN_CLASSNAME`. px-3.5 is the list's
 * px-5 less the title's own px-1.5: the title's mark starts at the avatars'
 * left edge.
 */
export const ROOM_SHELL_DESKTOP_HEADER_ROW_CLASSNAME = cn(
  ROOM_CONTENT_COLUMN_CLASSNAME,
  "flex min-w-0 flex-1 items-center justify-between gap-4 px-3.5",
);

/** Empty desktop header slot (Instant). Same outer box as live header. */
export const ROOM_SHELL_DESKTOP_HEADER_SLOT_CLASSNAME =
  "hidden h-16 shrink-0 border-b md:flex";

/**
 * Native scroller. Its one child carries `shrink-0`
 * (`ROOM_MESSAGE_LIST_CONTENT_CLASSNAME`): a flex column would otherwise
 * clamp it to the scroller's height and the list could not scroll up.
 */
export const ROOM_SHELL_SCROLLER_CLASSNAME = CHAT_MESSAGE_LIST_SCROLLER_CLASS;

interface RoomShellLayoutProps {
  testId?: string;
  dataSlot?: string;
  rootClassName?: string;
  beforeMain?: ReactNode;
  desktopHeader?: ReactNode | null;
  reserveDesktopHeader?: boolean;
  /**
   * Wrap header + scroller + composer (e.g. RoomFileDropZone).
   * Must render a flex column with ROOM_SHELL_COLUMN_CLASSNAME.
   */
  wrapColumn?: (columnBody: ReactNode) => ReactNode;
  listScrollerRef?: Ref<HTMLDivElement | null>;
  listContent: ReactNode;
  composer: ReactNode;
  /**
   * Sibling of the message column inside `main` (e.g. ThreadPanel). Must stay
   * under ROOM_SHELL_MAIN_CLASSNAME so absolute mobile overlay / lg side column
   * position against the room shell, not an outer fragment.
   */
  mainEnd?: ReactNode;
}

/**
 * Shared open-room chrome tree for Instant loading and progressive RoomsClient.
 */
export function RoomShellLayout({
  testId,
  dataSlot,
  rootClassName,
  beforeMain,
  desktopHeader = null,
  reserveDesktopHeader = true,
  wrapColumn,
  listScrollerRef,
  listContent,
  composer,
  mainEnd = null,
}: RoomShellLayoutProps): React.ReactElement {
  const { mainRef, sectionRef, headerRef, listRef, composerRef } =
    useRoomColumnSlide();
  const header =
    desktopHeader != null ? (
      <header className={ROOM_SHELL_DESKTOP_HEADER_CLASSNAME}>
        <div
          ref={headerRef}
          className={ROOM_SHELL_DESKTOP_HEADER_ROW_CLASSNAME}
        >
          {desktopHeader}
        </div>
      </header>
    ) : reserveDesktopHeader ? (
      <div className={ROOM_SHELL_DESKTOP_HEADER_SLOT_CLASSNAME} aria-hidden />
    ) : null;

  const columnBody = (
    <>
      {header}
      <div ref={listScrollerRef} className={ROOM_SHELL_SCROLLER_CLASSNAME}>
        <div
          ref={listRef}
          // Scopes the jump-highlight spotlight in globals.css to this list,
          // and names it so a lookup can tell it from the thread's copy of the
          // same message ids.
          data-chat-message-list={CHAT_MESSAGE_LIST_ROOM}
          className={ROOM_MESSAGE_LIST_CONTENT_CLASSNAME}
        >
          {listContent}
        </div>
      </div>
      <div
        ref={composerRef}
        className={cn("shrink-0", ROOM_CONTENT_COLUMN_CLASSNAME)}
      >
        {composer}
      </div>
    </>
  );

  const column = wrapColumn ? (
    wrapColumn(columnBody)
  ) : (
    <div className={ROOM_SHELL_COLUMN_CLASSNAME}>{columnBody}</div>
  );

  return (
    <div
      data-testid={testId}
      data-slot={dataSlot}
      className={rootClassName ?? ROOM_SHELL_ROOT_CLASSNAME}
    >
      {beforeMain}
      <main ref={mainRef} className={ROOM_SHELL_MAIN_CLASSNAME}>
        <section ref={sectionRef} className={ROOM_SHELL_SECTION_CLASSNAME}>
          {column}
        </section>
        {mainEnd}
      </main>
    </div>
  );
}
