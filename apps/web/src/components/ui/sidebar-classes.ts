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

/** The gap and the panel share this, so hiding the sidebar is one movement. */
export const SIDEBAR_HIDE_TRANSITION =
  "duration-200 ease-linear motion-reduce:transition-none";

/**
 * The shape of a **Sidebar row** (GLOSSARY.md), for the few places that cannot
 * be a `SidebarMenuButton` — a section's titled heading, an archived room's
 * static row, the loading skeleton. They are not buttons, but they stand in
 * the same list, so the rule that keeps rows aligned has to reach them.
 *
 * `h-11 md:h-7` is the vertical half of it: 28px with a pointer, so more rooms
 * and destinations fit above the fold, and 44px on the phone sheet so a thumb
 * keeps its target there. The matching `min-h` is the floor a two-line row
 * keeps when `SidebarMenuButton lines={2}` releases the height, so no list
 * ever names a row height of its own.
 *
 * `px-2` with `gap-2` is the horizontal half: it puts the 24px
 * `SidebarRowSlot` 16px in, centred on the 28px axis, and the label at 48px.
 */
export const SIDEBAR_ROW_CLASS =
  "flex h-11 min-h-11 w-full items-center gap-2 px-2 md:h-7 md:min-h-7";

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
 * A row's name: it takes the room left after the slot and gives it up before
 * the row's trailing controls, clipping rather than pushing them out.
 */
export const SIDEBAR_ROW_LABEL_CLASS = "min-w-0 flex-1 overflow-hidden";

/**
 * A row link at rest: quieter than the selected row's
 * `text-sidebar-accent-foreground`, filled on hover. Nav destinations, Soko
 * Bots, Catch up and rooms all rest this way, so they read as one list.
 */
export const SIDEBAR_ROW_LINK_CLASS =
  "text-tertiary-foreground dark:text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground";

/**
 * What the project scope scopes: the nav groups under the project title, tied
 * to it by a hairline down their leading side. The line starts 16px in, under
 * the title's first letter, so the groups read as inside the project; the
 * chat sections below sit outside it.
 */
export const SIDEBAR_PROJECT_SCOPED_CLASS = "border-sidebar-border ms-4 border-s";

/**
 * An icon action beside a row or a section's title (+ new channel, the team
 * link, Mark all as read, reorder Pinned): 28px, with a pseudo-element that
 * keeps its target at 44px on phones.
 */
/**
 * A row's trailing control, quiet until the row is hovered or holds focus.
 * Where nothing hovers (touch) it stays shown, so it is never out of reach.
 */
export const SIDEBAR_ROW_HOVER_REVEAL_CLASS =
  "motion-safe:transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/menu-item:opacity-100 [@media(hover:hover)]:group-focus-within/menu-item:opacity-100";

export const SIDEBAR_ICON_ACTION_CLASS =
  "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground relative flex size-7 items-center justify-center rounded-md transition-colors before:absolute before:-inset-2 before:content-[''] md:before:-inset-0.5";
