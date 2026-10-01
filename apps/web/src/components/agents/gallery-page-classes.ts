/**
 * The Agents page's hero band, headlines and section divider, shared with the
 * other gallery pages (Soko Bots) so they keep one type scale and surface.
 * Kept out of the client gallery module so Server Components can import it.
 */

/** Full-bleed hero band: same surface as the page, ruled off below. */
export const GALLERY_HERO_BAND_CLASS =
  "border-border -mx-4 -mt-4 border-b px-4 py-12 md:py-16";

export const GALLERY_HERO_INNER_CLASS =
  "mx-auto flex max-w-2xl flex-col items-center gap-6 text-center";

export const GALLERY_HERO_HEADLINE_CLASS =
  "text-foreground text-2xl font-light text-balance md:text-3xl tracking-tight";

export const GALLERY_SECTION_HEADLINE_CLASS =
  "text-foreground text-xl font-light md:text-2xl text-balance tracking-tight";

/** Breaks out of the page padding so the rule spans the view. */
export const GALLERY_DIVIDER_CLASS = "border-border -mx-4 border-t";

/** Vertical rhythm between the page's tiers. */
export const GALLERY_PAGE_SECTIONS_CLASS =
  "space-y-16 pb-8 md:space-y-24 md:px-2";

/** The overlapping faces above the hero headline, and their caption. */
export const GALLERY_SOCIAL_PROOF_FACE_CLASS = "size-7 rounded-full";
export const GALLERY_SOCIAL_PROOF_CAPTION_CLASS =
  "text-muted-foreground text-sm font-medium";
