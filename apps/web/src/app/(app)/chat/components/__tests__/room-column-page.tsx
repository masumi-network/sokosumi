/**
 * The page `room-column.webkit.test.ts` opens: an open room shell filling the
 * viewport (no app sidebar), so the room pane is the viewport width. A docked
 * side panel of any width opens and closes through `window.setPanel`.
 */
import { useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

import { RoomShellLayout } from "@/app/chat/components/room-shell-layout";

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
    /** The transcript and composer columns, and the root font size. */
    columns: () => { list: ColumnBox; composer: ColumnBox; rem: number };
  }
}

let showPanel: (width: number | null) => void = () => {};

function App() {
  const [panel, setPanel] = useState<number | null>(null);
  showPanel = setPanel;
  return (
    <RoomShellLayout
      rootClassName="flex h-screen min-h-0 min-w-0 flex-col overflow-hidden"
      desktopHeader={<span>Room</span>}
      listContent={<p>Short transcript, so the scroller shows no scrollbar.</p>}
      composer={<div className="h-24 border-t">composer</div>}
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

function box(node: Element | null): ColumnBox {
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

export function renderRoomColumnPage(): void {
  const host = document.getElementById("fixture");
  if (!host) throw new Error("Missing fixture host");
  window.setPanel = async (width) => {
    flushSync(() => showPanel(width));
    // The slide starts from the ResizeObserver, after the next layout.
    await twoFrames();
  };
  window.columns = () => ({
    list: box(document.querySelector("[data-chat-message-list]")),
    composer: box(document.querySelector("main > section > div > :last-child")),
    // WebKit's root tracks Dynamic Type (`-apple-system-body`), not 16px.
    rem: Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
  });
  createRoot(host).render(<App />);
}
