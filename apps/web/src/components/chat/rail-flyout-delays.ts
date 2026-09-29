/**
 * The collapsed rail's hover flyouts: the room rows' and the Threads entry's.
 * A plain module, not the `'use client'` row, so either side of the server
 * boundary can import the values.
 */

/**
 * A beat before the thread flyout opens, so running the pointer down the rail
 * does not throw a card out of every unread room on the way. The same beat
 * the app's other hover cards take.
 */
export const RAIL_FLYOUT_OPEN_DELAY_MS = 150;

/**
 * Long enough to cross the 12px gap from the mark onto the card without it
 * closing under the pointer. The rail's name tooltips open at once, so while
 * this runs a neighbour's tooltip and this card are both up; the card is on
 * its way out, and any shorter and the gap could not be crossed at all.
 */
export const RAIL_FLYOUT_CLOSE_DELAY_MS = 120;
