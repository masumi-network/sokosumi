/**
 * Row and column chrome (handles, row checkboxes, column menus) is painted
 * only where the pointer or focus is, so a long grid reads as data rather
 * than a field of controls. It stays in the DOM and the tab order, and focus
 * reveals it. A row's chrome shares the row-number cell with the number,
 * which steps aside while the chrome shows, so nothing shifts.
 */
export const GRID_ROW_CHROME =
  "opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100";
export const GRID_ROW_NUMBER =
  "transition-opacity group-hover/row:opacity-0 group-focus-within/row:opacity-0";
/** Column chrome; touch screens, which have no hover, always show it. */
export const GRID_HEAD_CHROME =
  "opacity-0 transition-opacity group-hover/head:opacity-100 group-focus-within/head:opacity-100 has-data-[state=open]:opacity-100 pointer-coarse:opacity-100";
/**
 * Sticky cells paint their row's background so scrolled cells pass under
 * them. The row numbers always stick. The first data column sticks just past
 * them (`start-16` is `ROW_NUMBER_WIDTH`) from md up only: on a phone a wide
 * first column would cover the screen and leave nothing to scroll into view.
 */
export const GRID_ROW_BACKGROUND =
  "bg-card-background group-hover/row:bg-accent group-data-[state=selected]/row:bg-muted transition-colors";
export const GRID_STICKY_ROW_NUMBER = "sticky start-0 z-10";
export const GRID_STICKY_FIRST_COLUMN = "md:sticky md:start-16 md:z-10";
/**
 * The selection ring: the accent, inside the gridlines so neighbours keep
 * theirs. It replaces the focus ring, so an unselected cell is the only one
 * that drops its outline (`outline-none` would also erase this one).
 */
export const GRID_SELECTED_CELL = "outline-2 -outline-offset-2 outline-ring";
/**
 * Bounded to the viewport on both axes, so the horizontal scrollbar and the
 * sticky header stay in reach. The scroll padding keeps a focused cell clear
 * of the sticky header and the sticky first columns (`--sheet-sticky`).
 */
export const GRID_SCROLL_CONTAINER =
  "overscroll-x-contain scroll-pt-11 scroll-ps-16 md:[scroll-padding-inline-start:var(--sheet-sticky)]";
