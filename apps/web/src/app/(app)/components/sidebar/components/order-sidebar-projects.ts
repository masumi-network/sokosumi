/**
 * Ordering rule for the rows in the sidebar's Projects flyout.
 *
 * Pins claim slots, they do not add rows: pinned projects render in the
 * reader's own order, and last-visited projects fill whatever is left up to
 * {@link SIDEBAR_PROJECT_ROW_CAP}. Pin the cap's worth and no recents show.
 * A pinned project never lists twice, matching the Pinned rule the chat
 * sidebar already uses (`partition-rooms-for-sidebar.ts`).
 *
 * Unlike that sidebar, the cap binds pins too: this list lives in a popover,
 * which cannot lean on the sidebar's scrollbar, so the panel is always the
 * same height and `All projects` reaches the rest (ADR-0036).
 *
 * Returns the rows to render plus `pinnedCount`, the length of the leading
 * pinned run — the panel draws its divider there. The `All projects` footer
 * is what reaches the projects the cap leaves out.
 *
 * Pure — no storage, no fetching.
 */

/** Whole rows only; the panel never scrolls inside itself. */
export const SIDEBAR_PROJECT_ROW_CAP = 5;

interface Identified {
  id: string;
}

export function orderSidebarProjects<T extends Identified>({
  projects,
  pinnedIds,
  visitedIds,
  cap = SIDEBAR_PROJECT_ROW_CAP,
}: {
  /** The workspace page as Core sorted it (latest activity first). */
  projects: readonly T[];
  /** Reader's pins, in the order they arranged them. */
  pinnedIds: readonly string[];
  /** Project ids the reader opened, newest first. */
  visitedIds: readonly string[];
  cap?: number;
}): { rows: T[]; pinnedCount: number } {
  const byId = new Map(projects.map((project) => [project.id, project]));

  const rows: T[] = [];
  const taken = new Set<string>();
  function take(id: string): boolean {
    if (taken.has(id)) return false;
    const project = byId.get(id);
    if (!project) return false;
    taken.add(id);
    rows.push(project);
    return true;
  }

  // Count what actually landed — a pin can point at a project this page does
  // not carry — so the recents budget below stays right, and stop at the cap
  // so a reader with twenty pins still gets a panel the size of the others.
  let pinnedRows = 0;
  for (const id of pinnedIds) {
    if (pinnedRows >= cap) break;
    if (take(id)) pinnedRows += 1;
  }

  // Recents fill what is left. Pins that ate the budget leave none.
  const slots = Math.max(cap - pinnedRows, 0);
  let recentRows = 0;
  for (const id of visitedIds) {
    if (recentRows >= slots) break;
    if (take(id)) recentRows += 1;
  }

  // Never-visited projects backfill in Core's activity order, so a reader with
  // an empty visit log still sees a useful list in their first session.
  for (const project of projects) {
    if (recentRows >= slots) break;
    if (take(project.id)) recentRows += 1;
  }

  return { rows, pinnedCount: pinnedRows };
}
