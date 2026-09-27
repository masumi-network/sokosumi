"use client";

import { type RefObject, useEffect, useRef, useSyncExternalStore } from "react";

/**
 * Tailwind's `xl`, the width at which the assistant stops covering the page.
 *
 * The same number the layout uses. If these two ever disagree, the panel looks
 * like an overlay and behaves like a sidebar, or the reverse — which is the
 * whole defect this file exists to fix.
 */
const WIDE = "(min-width: 80rem)";

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(WIDE);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * Whether a panel at this width covers the page rather than sitting beside it.
 *
 * `useSyncExternalStore` rather than an effect, so the first client render is
 * already correct: a panel that is modal for one frame and not the next would
 * move focus twice. The server snapshot is `false` — the wide layout, where
 * nothing is modal — because there is no viewport to measure there.
 */
export function useIsOverlayWidth(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => !window.matchMedia(WIDE).matches,
    () => false,
  );
}

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/** Everything inside `root` a Tab press can reach, in document order. */
export function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) =>
      !element.hasAttribute("hidden") &&
      element.getAttribute("aria-hidden") !== "true",
  );
}

/**
 * Take the rest of the document out of play while `kept` is on top of it.
 *
 * `inert` rather than `aria-hidden`, because the bug being fixed was not only
 * that a screen reader could still reach the page underneath — the keyboard
 * and the pointer could too. `aria-hidden` addresses neither; `inert` removes
 * the subtree from the tab order, from hit testing and from the accessibility
 * tree at once.
 *
 * What it does *not* do is stop the studio's global review shortcuts. Those
 * are a listener on `window`, and a keypress whose target is `<body>` reaches
 * it whatever is inert. Suspending them while the panel is modal is a separate
 * guard in the studio's own keydown handler, and this is not a substitute
 * for it.
 *
 * Only the siblings along `kept`'s ancestor chain are marked, never an
 * ancestor of `kept` itself, and an element that was already inert is left
 * alone so that releasing this does not un-hide someone else's overlay.
 */
export function hideOthers(kept: HTMLElement): () => void {
  const marked: HTMLElement[] = [];
  let node: HTMLElement = kept;
  // Up to `<body>` and no further. One more step would mark `<head>`, which
  // means nothing and leaves a stray attribute on the document.
  while (node !== document.body && node.parentElement) {
    const parent = node.parentElement;
    for (const sibling of Array.from(parent.children)) {
      if (sibling === node || !(sibling instanceof HTMLElement)) continue;
      if (sibling.hasAttribute("inert")) continue;
      sibling.setAttribute("inert", "");
      marked.push(sibling);
    }
    node = parent;
  }
  return () => {
    for (const element of marked) element.removeAttribute("inert");
  };
}

/**
 * Stop the page behind the sheet from scrolling under it.
 *
 * The application scrolls `main[data-app-main]`, not the document, and that
 * element already sets `scrollbar-gutter: stable` — so hiding its overflow
 * takes the scroll away without the content jumping sideways by a scrollbar
 * width. If the marker is ever absent this does nothing rather than locking
 * the wrong element.
 */
function lockPageScroll(): () => void {
  const scroller = document.querySelector<HTMLElement>("main[data-app-main]");
  if (!scroller) return () => {};
  const previous = scroller.style.overflow;
  scroller.style.overflow = "hidden";
  return () => {
    scroller.style.overflow = previous;
  };
}

/**
 * The parts of being a modal that a CSS breakpoint cannot express.
 *
 * The assistant is one mounted component that is a column at `xl` and a sheet
 * below it. Reaching for the Sheet primitive would portal it, which moves it
 * in the tree, which remounts it — and remounting the assistant throws away
 * the live transcript and the streaming turn. So the panel stays where it is
 * and the dialog contract is applied to it only while it is covering
 * something: focus moves in, Tab stays in, Escape closes, focus goes back
 * where it came from, and everything underneath is inert.
 *
 * While `active` is false this does nothing at all, which is what keeps the
 * desktop column an ordinary part of the page.
 */
export function useModalOverlay({
  active,
  contentRef,
  onDismiss,
}: {
  active: boolean;
  contentRef: RefObject<HTMLElement | null>;
  onDismiss: () => void;
}): void {
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;

  useEffect(() => {
    const content = contentRef.current;
    if (!active || !content) return;

    const returnTo =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const release = hideOthers(content);
    const unlock = lockPageScroll();

    (focusableWithin(content)[0] ?? content).focus();

    function onKeyDown(event: KeyboardEvent) {
      if (!content) return;
      if (event.key === "Escape") {
        event.preventDefault();
        // Stopped here: an Escape meant for this panel must not also close a
        // menu or a lightbox that happens to be listening further up.
        event.stopPropagation();
        dismiss.current();
        return;
      }
      if (event.key !== "Tab") return;

      const items = focusableWithin(content);
      if (items.length === 0) {
        event.preventDefault();
        content.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement;
      const outside = !(current instanceof Node) || !content.contains(current);
      if (event.shiftKey ? current === first || outside : false) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (current === last || outside)) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      unlock();
      release();
      // Where focus is by now, not where it was. React has usually detached
      // the panel before this runs, which drops focus to `<body>` — so "still
      // inside the panel" and "nowhere" both mean the person was in here and
      // needs somewhere to land. Focus that has moved on to a real element
      // elsewhere is left alone: widening the window past `xl` closes the
      // panel too, and that must not yank focus to a button nobody pressed.
      const now = document.activeElement;
      const strandedInPanel = now instanceof Node && content.contains(now);
      const strandedOnBody = now === null || now === document.body;
      if ((strandedInPanel || strandedOnBody) && returnTo?.isConnected) {
        returnTo.focus();
      }
    };
  }, [active, contentRef]);
}
