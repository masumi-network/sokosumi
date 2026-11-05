/**
 * Whether `pathname` is `route` or a page under it: what makes a nav row the
 * current destination. `/tasks-archive` is not under `/tasks`.
 */
export function isPathActive(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`);
}
