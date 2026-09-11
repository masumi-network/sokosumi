import * as Sentry from "@sentry/node";

/** The JSON columns a notification row carries. */
type NotificationRowJsonField = "messageParams" | "metadata";

/**
 * Read one of a notification row's JSON columns, or report that it will not.
 *
 * Both columns are written by `JSON.stringify` on every path that writes
 * them, so a row that will not parse is one something else wrote, or one
 * damaged after it was written. Every reader of it carries on with an answer
 * that is safe rather than right: a count that undercounts, a banner without
 * its number, a row left holding a deleted message's text. The row stays that
 * way for as long as it exists, and nothing else would ever say so.
 *
 * A column that parses into something that is not an object is the same
 * damage said more quietly. `null` and a bare number both parse, and neither
 * carries a field any reader here asks for, so each one leaves the reader on
 * the same fallback a throw does. Reporting the throw alone would leave the
 * quieter half of the same defect silent.
 *
 * A column that is an object without the field the caller wants is not
 * damage. The first row of a room carries no count, and a row written before
 * a field existed carries none either, so that answer is left to the caller.
 */
export function readNotificationRowJson(
  json: string,
  rowId: string,
  field: NotificationRowJsonField,
): Record<string, unknown> | null {
  let stored: unknown;

  try {
    stored = JSON.parse(json);
  } catch (error) {
    reportUnreadableRow(whyItWouldNotRead(error), rowId, field);

    return null;
  }

  if (typeof stored !== "object" || stored === null) {
    reportUnreadableRow("it is not an object", rowId, field);

    return null;
  }

  return stored as Record<string, unknown>;
}

/**
 * How many damaged rows one process names before it stops naming them.
 *
 * Reached only by a defect that damaged rows in bulk, and by then the first
 * five hundred have said everything the next one would.
 */
const REPORTED_ROW_LIMIT = 500;

/**
 * The rows this process has already named.
 *
 * A damaged row is not healed by being read, and the paths that read it run
 * again on every message: the banner count re-reads every unread row in the
 * room on every publish. Reported per read, one bad backfill in a busy room
 * is rows times messages times recipients, all of it the same row saying the
 * same thing. Reported per row, it is one event and then silence.
 *
 * Per process, so a long-lived instance says it once and a new instance says
 * it again after a deploy. That is the property that keeps it findable: an
 * issue that fell off the first page a month ago comes back rather than being
 * suppressed for good by a process that has since been replaced.
 *
 * Tests of this reader must use a row id of their own. Two tests reading the
 * same damaged id in one file share this set, and the second one sees silence.
 */
const reportedRows = new Set<string>();

/** Whether this row has already been named, and remembers it if it has not. */
function alreadySaid(rowId: string, field: NotificationRowJsonField): boolean {
  const row = `${rowId}:${field}`;

  if (reportedRows.has(row)) {
    return true;
  }

  if (reportedRows.size >= REPORTED_ROW_LIMIT) {
    return true;
  }

  reportedRows.add(row);

  return false;
}

/**
 * Say that a row will not read, without saying what it held.
 *
 * The reason is synthesized rather than passed on. A parse error carries the
 * opening characters of what it could not read, and those characters are a
 * message preview, an author's name, a room's name. Core's Sentry runs with
 * `sendDefaultPii`, so what goes to it says why the row would not read and
 * nothing of what was in it.
 */
function reportUnreadableRow(
  reason: string,
  rowId: string,
  field: NotificationRowJsonField,
): void {
  if (alreadySaid(rowId, field)) {
    return;
  }

  Sentry.captureException(
    new Error(`A notification row will not read: ${reason}`),
    {
      extra: {
        rowId,
        field,
        notificationType: "notification_row_decode",
      },
    },
  );
}

/** Why a decode failed, said without quoting what failed to decode. */
function whyItWouldNotRead(error: unknown): string {
  return error instanceof Error ? error.name : "a throw that is not an Error";
}
