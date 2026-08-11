import type { CSSProperties, ReactNode, Ref } from "react";

import { CHAT_MESSAGE_LIST_SCROLLER_CLASS } from "@/app/chat/chat-message-list-scroller";
import { CHAT_MOBILE_HEIGHT_SHELL_NO_TAB_BAR_CLASS } from "@/app/chat/components/chat-mobile-tab-registry";
import { ROOM_MESSAGE_LIST_CONTENT_CLASSNAME } from "@/app/chat/components/room-message-list-skeleton";
import { cn } from "@/lib/utils";

/** Root height for open room (no mobile tab bar). Instant + live must match. */
export const ROOM_SHELL_ROOT_CLASSNAME = cn(
  "-m-4 flex min-h-0 min-w-0 flex-col overflow-hidden bg-background",
  CHAT_MOBILE_HEIGHT_SHELL_NO_TAB_BAR_CLASS,
);

export const ROOM_SHELL_MAIN_CLASSNAME =
  "relative flex min-h-0 min-w-0 flex-1 overflow-x-clip";

export const ROOM_SHELL_SECTION_CLASSNAME =
  "flex min-h-0 min-w-0 flex-1 flex-col";

/** Column that holds desktop header + scroller + composer. */
export const ROOM_SHELL_COLUMN_CLASSNAME =
  "flex min-h-0 min-w-0 flex-1 flex-col";

export const ROOM_SHELL_DESKTOP_HEADER_CLASSNAME =
  "flex h-16 shrink-0 items-center justify-between gap-4 border-b px-6";

/** Empty desktop header slot (Instant). Same outer box as live header. */
export const ROOM_SHELL_DESKTOP_HEADER_SLOT_CLASSNAME =
  "hidden h-16 shrink-0 border-b md:flex";

export const ROOM_SHELL_SCROLLER_CLASSNAME = cn(
  CHAT_MESSAGE_LIST_SCROLLER_CLASS,
  "flex flex-col",
);

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
  listContentRef?: Ref<HTMLDivElement | null>;
  listContentStyle?: CSSProperties;
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
  listContentRef,
  listContentStyle,
  listContent,
  composer,
  mainEnd = null,
}: RoomShellLayoutProps): React.ReactElement {
  const header =
    desktopHeader != null ? (
      <header className={ROOM_SHELL_DESKTOP_HEADER_CLASSNAME}>
        {desktopHeader}
      </header>
    ) : reserveDesktopHeader ? (
      <div className={ROOM_SHELL_DESKTOP_HEADER_SLOT_CLASSNAME} aria-hidden />
    ) : null;

  const columnBody = (
    <>
      {header}
      <div ref={listScrollerRef} className={ROOM_SHELL_SCROLLER_CLASSNAME}>
        <div
          ref={listContentRef}
          className={ROOM_MESSAGE_LIST_CONTENT_CLASSNAME}
          style={listContentStyle}
        >
          {listContent}
        </div>
      </div>
      {composer}
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
      <main className={ROOM_SHELL_MAIN_CLASSNAME}>
        <section className={ROOM_SHELL_SECTION_CLASSNAME}>{column}</section>
        {mainEnd}
      </main>
    </div>
  );
}
