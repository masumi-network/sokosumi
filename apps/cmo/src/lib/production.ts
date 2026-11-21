import type { CmoOverview } from "@sokosumi/core-client";

type Production = CmoOverview["production"];

/**
 * How far the month is, in percent. Each piece counts its words, its picture
 * when it needs one, and being finished, so the bar moves while Cuso writes
 * every piece's words before any of them is finished.
 */
export function productionShare(production: Production): number {
  if (production.state === "ready") return 100;
  const steps = production.total * 2 + production.needPictures;
  if (steps === 0) return 0;
  const done = production.written + production.pictured + production.ready;
  return Math.round((done / steps) * 100);
}

/**
 * The two passes of a run, as the owner reads them, out of the month's
 * posts: what Core no longer makes (already out) counts as written.
 */
export function productionSteps(
  production: Production,
  monthTotal: number = production.total,
): string {
  const done = Math.max(0, monthTotal - production.total);
  const words = `Words ${production.written + done} of ${Math.max(monthTotal, production.total)}`;
  return production.needPictures > 0
    ? `${words} · Pictures ${production.pictured} of ${production.needPictures}`
    : words;
}
