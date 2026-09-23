/**
 * The Sidebar's shared shape vocabulary, as plain Tailwind class strings.
 *
 * These live beside `sidebar.tsx` rather than in it because `sidebar.tsx` is a
 * `"use client"` module: a Server Component that imports a non-component value
 * across that boundary gets a client reference, not the string, so
 * `cn(SIDEBAR_ROW_CLASS, …)` silently collapsed to `""` and the row lost its
 * flex, height and padding. Components cross the boundary fine; constants do
 * not, so the constants stay on this side of it.
 */

/** Gap, panel and row share this so the collapse is one movement. */
export const SIDEBAR_COLLAPSE_TRANSITION =
  "duration-200 ease-linear motion-reduce:transition-none";

/**
 * The shape of a **Sidebar row** (CONTEXT.md), for the few places that cannot
 * be a `SidebarMenuButton` — a section's titled heading, an archived room's
 * static row, the loading skeleton. They are not buttons, but they stand in
 * the same list, so the rule that keeps rows from moving has to reach them.
 *
 * `h-11 md:h-8` is the whole vertical half of it. The row used to be a 40px
 * minimum expanded and a 32px square on the rail, so every row above the
 * first Chat room pushed the list down when the sidebar toggled; the rail's
 * square is the size that stays. Below `md` the sidebar is a Sheet and never
 * the rail, so a thumb keeps its 44px target there.
 *
 * `px-2` with `gap-2` is the horizontal half: it puts the 24px
 * `SidebarRowSlot` 16px in, centred on the 28px axis, and the label at 48px.
 */
export const SIDEBAR_ROW_CLASS =
  "flex h-11 w-full items-center gap-2 px-2 md:h-8";

/**
 * A rail item's 32px square, on the sidebar's 28px leading axis.
 *
 * 4px of its own rather than `mx-auto`: the rail's 1px right border leaves
 * its own centre on a half pixel, and the axis has to be a whole one for the
 * expanded panel's sake, so the square gives up half a pixel of its own
 * symmetry instead. Padding is the caller's — a row drops `px` and keeps its
 * height, the account chip drops all four.
 */
export const SIDEBAR_RAIL_SQUARE_CLASS =
  "group-data-[collapsible=icon]:ml-1 group-data-[collapsible=icon]:w-8! group-data-[collapsible=icon]:justify-center";

/**
 * Collapsed padding that keeps a row's mark on the 28px axis while a name
 * is still in the flex flow. Same 4px as centering a 24px slot in a 32px
 * square, without `justify-center` dragging the mark toward the label.
 * The account chip does not use this — it drops all four paddings.
 */
export const SIDEBAR_ROW_RAIL_PAD_CLASS =
  "group-data-[collapsible=icon]:pr-0! group-data-[collapsible=icon]:pl-1! group-data-[collapsible=icon]:justify-start!";

/**
 * Where a row's label starts, for text that carries no mark of its own — a
 * section's empty line.
 *
 * 40px, not 48: measured from the row's own box, which already sits 8px in on
 * the group's padding. Inside that box a row spends 8px of `px-2`, 24px of
 * slot and 8px of `gap-2`, which is the same 40px — so the text lands on the
 * 48px column from the sidebar's edge, where every label starts.
 */
export const SIDEBAR_ROW_LABEL_INSET_CLASS = "pl-10";

/**
 * A row's name on collapse. `sr-only` clipped it to 1px on the first frame.
 * `absolute` then painted it on top of the mark while the panel narrowed.
 * It stays in the flex flow at the 48px column; max-width eases to 0 on the
 * same 200ms linear clock as the panel, so the name clips from the right
 * instead of covering the icon. Reduced motion jumps to the end state.
 */
export const SIDEBAR_ROW_LABEL_CLASS = `min-w-0 flex-1 max-w-full overflow-hidden transition-[max-width] ${SIDEBAR_COLLAPSE_TRANSITION} group-data-[collapsible=icon]:max-w-0`;

/**
 * A fixed name's overflow, for rows whose names always fit at full width
 * (New Task, Search, Soko Bots). Clipped, not ellipsized: an ellipsis
 * re-truncates the name on every frame of the collapse ("New T…", "Ne…"),
 * so the name looked squeezed into the narrowing row instead of the row
 * sliding over it. `!` because the menu button's own
 * `[&>span:last-child]:truncate` would put the ellipsis back.
 */
export const SIDEBAR_ROW_FIXED_LABEL_CLASS = "whitespace-nowrap text-clip!";
