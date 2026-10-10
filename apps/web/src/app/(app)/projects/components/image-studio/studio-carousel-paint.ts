export const STUDIO_SNAP_TARGET_ATTR = "data-studio-snap-target";
export const STUDIO_DRAGGING_ATTR = "data-studio-dragging";
export const STUDIO_SELECT_NONE_CLASS = "select-none";
export const STUDIO_TOUCH_CALLOUT_NONE_CLASS = "[-webkit-touch-callout:none]";

export interface StudioCarouselSlide {
  slide: HTMLElement;
  card: HTMLElement | null;
  preview: HTMLElement | null;
}

/** The carousel region, so drag state can sit on the same node CSS reads. */
export function studioCarouselRoot(rootNode: HTMLElement): HTMLElement {
  return rootNode.closest("[data-slot=carousel]") ?? rootNode;
}

/** Drag flag, compositor hint, and a document selection lock. Cleared on up or cancel. */
export function setStudioCarouselDragging(
  root: HTMLElement,
  slides: readonly StudioCarouselSlide[],
  dragging: boolean,
): void {
  if (dragging) {
    window.getSelection()?.removeAllRanges();
    document.body.classList.add(STUDIO_SELECT_NONE_CLASS);
    root.setAttribute(STUDIO_DRAGGING_ATTR, "");
    for (const { card } of slides) {
      if (card) card.style.willChange = "transform";
    }
    return;
  }
  document.body.classList.remove(STUDIO_SELECT_NONE_CLASS);
  root.removeAttribute(STUDIO_DRAGGING_ATTR);
  for (const { card } of slides) {
    if (card) card.style.willChange = "";
  }
}

/** Cache the card and preview nodes so a scroll frame does not query the DOM. */
export function collectStudioCarouselSlides(
  slides: readonly HTMLElement[],
): StudioCarouselSlide[] {
  return slides.map((slide) => ({
    slide,
    card: slide.querySelector<HTMLElement>("[data-template-card]"),
    preview: slide.querySelector<HTMLElement>("[data-template-preview]"),
  }));
}

/**
 * Depth for the empty-studio carousel.
 *
 * Reads every slide box first, then writes transforms. No blur: a filter on
 * fourteen moving images was the frame-time hog. Opacity and z-index still
 * put the centre card in front.
 */
export function paintStudioCarouselDepth({
  viewport,
  slides,
  reduceMotion,
}: {
  viewport: DOMRectReadOnly;
  slides: readonly StudioCarouselSlide[];
  reduceMotion: boolean;
}): void {
  if (reduceMotion) {
    for (const { slide, card, preview } of slides) {
      if (!card || !preview) continue;
      card.style.transform = "";
      preview.style.filter = "";
      preview.style.opacity = "";
      slide.style.zIndex = "";
      card.removeAttribute(STUDIO_SNAP_TARGET_ATTR);
    }
    return;
  }

  const center = viewport.left + viewport.width / 2;
  const writes: {
    slide: HTMLElement;
    card: HTMLElement;
    preview: HTMLElement;
    offset: number;
    distance: number;
  }[] = [];

  for (const { slide, card, preview } of slides) {
    if (!card || !preview) continue;
    const bounds = slide.getBoundingClientRect();
    if (!bounds.width) continue;
    const offset = (bounds.left + bounds.width / 2 - center) / bounds.width;
    writes.push({
      slide,
      card,
      preview,
      offset,
      distance: Math.min(Math.abs(offset), 3),
    });
  }

  let nearest: (typeof writes)[number] | undefined;
  for (const write of writes) {
    if (!nearest || write.distance < nearest.distance) nearest = write;
  }

  for (const write of writes) {
    const { slide, card, preview, offset, distance } = write;
    card.style.transform = `translateX(-50%) perspective(1000px) translateZ(${80 - distance * 40}px) rotateY(${-offset * 8}deg) rotateZ(${offset * 3}deg) scale(${1 - distance * 0.1})`;
    preview.style.filter = "";
    preview.style.opacity = String(1 - distance * 0.15);
    slide.style.zIndex = String(20 - Math.round(distance * 5));
    if (write === nearest) card.setAttribute(STUDIO_SNAP_TARGET_ATTR, "");
    else card.removeAttribute(STUDIO_SNAP_TARGET_ATTR);
  }
}
