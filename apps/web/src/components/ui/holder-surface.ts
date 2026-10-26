/**
 * The page surfaces every app page uses (DESIGN.md, Page surfaces): a
 * borderless light-gray holder on the white page, and items inside it back on
 * the page background with an outline. Kept out of client modules so Server
 * Components can import it.
 */

/** The darker rounded container a list sits in. */
export const HOLDER_CLASS = "bg-card-background rounded-xl p-2";

/** One item inside a holder: page background, outlined. */
export const HOLDER_ITEM_CLASS = "bg-background rounded-lg border border-border";

/** An item that responds to the pointer. */
export const HOLDER_ITEM_HOVER_CLASS = "hover:bg-card-background-hover";
