/**
 * The page `use-room-column-slide.webkit.test.ts` opens: an open room shell
 * filling the viewport (no app sidebar), so the room pane is the viewport
 * width. A docked side panel of any width opens and closes through
 * `window.setPanel`; `window.setOverlay` reshapes `wrapColumn` the way the
 * file drop zone does, which remounts the column body.
 */
import { type ReactNode, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

import {
  ROOM_SHELL_COLUMN_CLASSNAME,
  RoomShellLayout,
} from "@/app/chat/components/room-shell-layout";

/** Where a column sits in the room pane, and its running slide. */
export interface ColumnBox {
  left: number;
  width: number;
  /** First keyframe of the running slide, or null when none runs. */
  slideFrom: string | null;
}

declare global {
  interface Window {
    /** Dock a side panel `width` px wide, or close it with null. */
    setPanel: (width: number | null) => Promise<void>;
    /** Add or drop a second child beside the column body, as the drop zone does. */
    setOverlay: (shown: boolean) => Promise<void>;
    /** The header row, transcript and composer columns, and the column's max width. */
    columns: () => {
      header: ColumnBox;
      list: ColumnBox;
      composer: ColumnBox;
      maxWidth: number;
    };
    /** The composer column node, to tell a remount from an update. */
    composerNode: () => Element | null;
  }
}

let showPanel: (width: number | null) => void = () => {};
let showOverlay: (shown: boolean) => void = () => {};

function App() {
  const [panel, setPanel] = useState<number | null>(null);
  const [overlay, setOverlay] = useState(false);
  showPanel = setPanel;
  showOverlay = setOverlay;
  return (
    <RoomShellLayout
      rootClassName="flex h-dvh min-h-0 min-w-0 flex-col overflow-hidden"
      desktopHeader={<span>Room</span>}
      listContent={<p>Short transcript, so the scroller shows no scrollbar.</p>}
      composer={
        <div data-testid="composer" className="h-24 border-t">
          composer
        </div>
      }
      // One child, then two: React remounts the body, as `RoomFileDropZone`
      // does when a room turns writable.
      wrapColumn={(body: ReactNode) =>
        overlay ? (
          <div className={ROOM_SHELL_COLUMN_CLASSNAME}>
            {body}
            <span hidden />
          </div>
        ) : (
          <div className={ROOM_SHELL_COLUMN_CLASSNAME}>{body}</div>
        )
      }
      mainEnd={
        panel === null ? null : (
          <aside className="shrink-0 border-l" style={{ width: panel }}>
            panel
          </aside>
        )
      }
    />
  );
}

function box(node: Element | null | undefined): ColumnBox {
  if (!(node instanceof HTMLElement)) throw new Error("Missing column");
  // offsetLeft is from `main` (the positioned pane), without the slide.
  const slide = node.getAnimations()[0];
  const first =
    slide?.effect instanceof KeyframeEffect
      ? slide.effect.getKeyframes()[0]
      : undefined;
  return {
    left: node.offsetLeft,
    width: node.offsetWidth,
    slideFrom: typeof first?.transform === "string" ? first.transform : null,
  };
}

const twoFrames = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );

export function renderRoomColumnSlidePage(): void {
  const host = document.getElementById("fixture");
  if (!host) throw new Error("Missing fixture host");
  window.setPanel = async (width) => {
    flushSync(() => showPanel(width));
    // The slide starts from the ResizeObserver, after the next layout.
    await twoFrames();
  };
  window.setOverlay = async (shown) => {
    flushSync(() => showOverlay(shown));
    await twoFrames();
  };
  window.composerNode = () =>
    document.querySelector('[data-testid="composer"]')?.parentElement ?? null;
  window.columns = () => {
    const list = document.querySelector("[data-chat-message-list]");
    return {
      header: box(document.querySelector("header")?.firstElementChild),
      list: box(list),
      composer: box(window.composerNode()),
      // 56rem in px: WebKit's root tracks Dynamic Type, so not always 896.
      maxWidth: list ? Number.parseFloat(getComputedStyle(list).maxWidth) : 0,
    };
  };
  createRoot(host).render(<App />);
}
