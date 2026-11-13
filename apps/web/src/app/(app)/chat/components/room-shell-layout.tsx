import { AnimatePresence } from "motion/react";
import { type ReactNode, type Ref, type RefObject, useCallback } from "react";

import { CHAT_MESSAGE_LIST_ROOM } from "@/app/chat/chat-message-list";
import { CHAT_MESSAGE_LIST_SCROLLER_CLASS } from "@/app/chat/chat-message-list-scroller";
import { CHAT_MOBILE_HEIGHT_SHELL_NO_TAB_BAR_CLASS } from "@/app/chat/components/chat-mobile-tab-registry";
import {
  ROOM_CONTENT_COLUMN_CLASSNAME,
  ROOM_MESSAGE_LIST_CONTENT_CLASSNAME,
} from "@/app/chat/components/room-message-list-skeleton";
import {
  useRoomPanelSlide,
  useRoomPanelSlideOut,
} from "@/app/chat/components/use-room-panel-slide";
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

/**
 * Spans the section, outside the reading column. px-3.5 is the list's px-5 less
 * the title's own px-1.5: where the column fills the section, the title's mark
 * starts at the avatars' left edge.
 */
export const ROOM_SHELL_DESKTOP_HEADER_CLASSNAME =
  "flex h-16 shrink-0 items-center justify-between gap-4 border-b px-3.5";

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
 * The box a docked side panel slides in. Below `lg` it has none (`contents`), so
 * a panel's `absolute inset-0` still measures against the room shell. A closing
 * panel leaves the flow at once, and the room takes its width while it slides.
 */
function RoomSidePanelSlot({
  panelRef,
  children,
}: {
  panelRef: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  const isPresent = useRoomPanelSlideOut(panelRef);
  return (
    <div
      ref={panelRef}
      inert={!isPresent}
      className={cn(
        "contents lg:flex lg:min-h-0 lg:shrink-0",
        !isPresent && "lg:absolute lg:inset-y-0 lg:right-0",
      )}
    >
      {children}
    </div>
  );
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
  const { mainRef, sectionRef, panelRef, listRef, composerRef } =
    useRoomPanelSlide();
  const attachOverlay = useCallback(
    (wrapper: HTMLDivElement | null) => {
      const composerSlot = composerRef.current;
      const scroller = listRef.current?.parentElement;
      if (!wrapper || !composerSlot || !scroller) return;

      let composerHeight = 0;
      let observedCard: Element | null = null;
      const measure = () => {
        const nextHeight = composerSlot.offsetHeight;
        const slotBounds = composerSlot.getBoundingClientRect();
        const card = composerSlot.querySelector(
          "[data-room-composer-mention-anchor]",
        );
        if (card !== observedCard) {
          if (observedCard) observer.unobserve(observedCard);
          if (card) observer.observe(card);
          observedCard = card;
        }
        const cardBounds = (card ?? composerSlot).getBoundingClientRect();
        const cardTop = cardBounds.top - slotBounds.top;
        // Fade only below the card's middle, even with a tall tray above it.
        wrapper.style.setProperty(
          "--room-composer-fade-start",
          `${Math.round(cardTop + cardBounds.height / 2)}px`,
        );
        wrapper.style.setProperty(
          "--room-composer-fade-end",
          `${Math.round(cardTop + cardBounds.height)}px`,
        );
        wrapper.style.setProperty(
          "--room-scrollbar-w",
          `${scroller.offsetWidth - scroller.clientWidth}px`,
        );
        if (nextHeight === composerHeight) return;
        // Read before changing the padding: growing drafts must keep latest
        // pinned without pulling a reader away from older messages.
        const wasAtBottom =
          scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop <=
          4;
        composerHeight = nextHeight;
        wrapper.style.setProperty("--room-composer-h", `${nextHeight}px`);
        if (wasAtBottom) {
          scroller.scrollTop = scroller.scrollHeight - scroller.clientHeight;
        }
      };
      const observer = new ResizeObserver(measure);
      // Ref attachment runs before paint, including in the Instant shell.
      measure();
      observer.observe(composerSlot);
      observer.observe(scroller);
      return () => observer.disconnect();
    },
    [composerRef, listRef],
  );
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
      <div
        ref={attachOverlay}
        className="relative flex min-h-0 flex-1 flex-col"
      >
        <div
          ref={listScrollerRef}
          className={cn(
            ROOM_SHELL_SCROLLER_CLASSNAME,
            "relative z-0 [scroll-padding-bottom:var(--room-composer-h,0px)]",
          )}
        >
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
        {/* A full-width overlay fades row backgrounds too, without masking the scrollbar. */}
        <div
          aria-hidden
          data-room-composer-fade
          className="pointer-events-none absolute start-0 end-[var(--room-scrollbar-w,0px)] bottom-0 z-0 h-[var(--room-composer-h,0px)]"
          style={{
            backgroundImage:
              "linear-gradient(to bottom, transparent var(--room-composer-fade-start,50%), var(--background) var(--room-composer-fade-end,100%))",
          }}
        />
        <div
          ref={composerRef}
          className={cn(
            "pointer-events-none absolute inset-x-0 bottom-0 z-10",
            ROOM_CONTENT_COLUMN_CLASSNAME,
          )}
        >
          {composer}
        </div>
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
        {/* One key, so swapping one panel for another keeps the slot and does
            not slide. */}
        <AnimatePresence initial={false}>
          {mainEnd != null ? (
            <RoomSidePanelSlot key="panel" panelRef={panelRef}>
              {mainEnd}
            </RoomSidePanelSlot>
          ) : null}
        </AnimatePresence>
      </main>
    </div>
  );
}
