/** The form of a day in the period filter, as Core reads it. */
const SEO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A real day of the calendar in the form of the filter: "2026-02-30" has the form and is no day. */
export function seoFilterDayValid(day: string) {
  const date = new Date(`${day}T00:00:00Z`);
  return (
    SEO_DAY.test(day) &&
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === day
  );
}

/** The filters that choose the time the page shows, not what it shows. */
const DATE_PARAMS = ["from", "to"];

/**
 * Two workspace reads of one selection: the same viewer, owner, page, scope and channel. Only their dates differ.
 * The last part of a key is the read's query string.
 */
export function seoSameSelection(
  left: readonly unknown[],
  right: readonly unknown[],
) {
  const selection = (key: readonly unknown[]) => {
    const query = new URLSearchParams(String(key.at(-1) ?? ""));
    for (const name of DATE_PARAMS) query.delete(name);
    return JSON.stringify([...key.slice(0, -1), query.toString()]);
  };
  return selection(left) === selection(right);
}
