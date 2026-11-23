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

/** "at 14:30", or "tomorrow at 09:10": when a stopped month's next run starts. */
export function retryWhen(
  retryAt: string | null,
  timeZone: string,
  now: Date = new Date(),
): string {
  if (!retryAt) return "soon";
  const at = new Date(retryAt);
  try {
    const time = at.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone,
    });
    const day = (date: Date) => date.toLocaleDateString("en-CA", { timeZone });
    return day(at) === day(now) ? `at ${time}` : `tomorrow at ${time}`;
  } catch {
    return `at ${at.toISOString().slice(11, 16)} UTC`;
  }
}

/** "1 post has no picture…": posts whose picture never passed the brand check. */
export function withoutPictureLine(production: Production): string | null {
  const count = production.withoutPicture.length;
  if (count === 0) return null;
  return count === 1
    ? "1 post has no picture: none he made fit your brand, so it stays a draft."
    : `${count} posts have no picture: none he made fit your brand, so they stay drafts.`;
}
