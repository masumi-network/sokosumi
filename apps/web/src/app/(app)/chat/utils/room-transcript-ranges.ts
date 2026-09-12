import type { ChatRoomMessage } from "@/lib/clients/generated/core";

import { mergeRoomMessages } from "./merge-room-messages";

/**
 * Rows fetched per jump window and per boundary load. Small enough that a
 * jump into a long room costs a fraction of the newest page, large enough
 * that a gap fills in a handful of loads.
 */
export const ROOM_HISTORY_WINDOW_LIMIT = 30;

export interface RoomTranscriptPage {
  messages: ChatRoomMessage[];
  /** Null when Core has nothing older than this page. */
  nextCursor: string | null;
}

/** Position of a message in reading order: createdAt, then id. */
interface MessageOrderKey {
  time: number;
  id: string;
}

/**
 * The room's loaded top-level history as a flat sorted list plus the older
 * edge of every contiguous range in it.
 *
 * Every message belongs to exactly one range: range `i` is the run of
 * messages from `rangeEdges[i]` up to (not including) `rangeEdges[i + 1]`,
 * and the last range is the head, open to the present. Realtime messages
 * therefore land in the head on their own, and a row deleted from a range
 * edge moves the boundary to the next row rather than losing it.
 *
 * Kept as edges rather than as one array per range so the many places that
 * update rows in place (reactions, edits, tombstones, outbound shells) keep
 * working on a flat list through `updateRoomTranscriptMessages`.
 */
export interface RoomTranscript {
  messages: ChatRoomMessage[];
  /** Older edge of each range, ascending. Empty until a page has arrived. */
  rangeEdges: MessageOrderKey[];
  /** True while Core has rows older than the first range. */
  oldestHasMore: boolean;
}

export type RoomTranscriptRow =
  | { kind: "message"; message: ChatRoomMessage }
  | {
      kind: "boundary";
      /** First message of the range below; the cursor an older page loads from. */
      cursorMessageId: string;
      /** Between two ranges, as opposed to above the oldest one. */
      isGap: boolean;
    };

/** Message row plus the neighbors the transcript chrome needs. */
export type RoomTranscriptRenderRow =
  | Extract<RoomTranscriptRow, { kind: "boundary" }>
  | {
      kind: "message";
      message: ChatRoomMessage;
      /** Unset after a boundary so continuation does not cross a gap. */
      previousMessage: ChatRoomMessage | undefined;
      /** Previous row in reading order, including across a gap. */
      dayPreviousMessage: ChatRoomMessage | undefined;
    };

export function emptyRoomTranscript(): RoomTranscript {
  return { messages: [], rangeEdges: [], oldestHasMore: false };
}

/** Update rows without changing what the transcript knows about history. */
export function updateRoomTranscriptMessages(
  transcript: RoomTranscript,
  update: (messages: ChatRoomMessage[]) => ChatRoomMessage[],
): RoomTranscript {
  const messages = update(transcript.messages);
  if (messages === transcript.messages) {
    return transcript;
  }
  return { ...transcript, messages };
}

/**
 * The newest page, on room open or on a refetch. Contiguous from its oldest
 * row to the present, so it always joins the head and may swallow a jump
 * window it reaches.
 */
export function mergeRoomHeadPage(
  transcript: RoomTranscript,
  page: RoomTranscriptPage,
): RoomTranscript {
  return mergeContiguousRange(transcript, page, true);
}

/** A window around a jump target. Joins whatever ranges it overlaps. */
export function mergeRoomJumpWindow(
  transcript: RoomTranscript,
  page: RoomTranscriptPage,
): RoomTranscript {
  return mergeContiguousRange(transcript, page, false);
}

/**
 * A page loaded from a boundary row: rows directly older than the range that
 * starts at `cursorMessageId`. The cursor row is folded into the page so the
 * page always joins that range, and joins the range above when it reaches it
 * or when Core says nothing older exists.
 */
export function mergeRoomOlderPage(
  transcript: RoomTranscript,
  cursorMessageId: string,
  page: RoomTranscriptPage,
): RoomTranscript {
  const cursorRow = transcript.messages.find(
    (row) => row.id === cursorMessageId,
  );
  if (!cursorRow) {
    return mergeContiguousRange(transcript, page, false);
  }
  return mergeContiguousRange(
    transcript,
    { messages: [...page.messages, cursorRow], nextCursor: page.nextCursor },
    false,
  );
}

/**
 * The rows the transcript renders: messages in reading order with a boundary
 * row before the first message of every range that has history missing
 * above it. `messages` may be a filtered view of the transcript (stream
 * overlay applied, empty shells dropped); boundaries still land on the first
 * visible row at or after their edge.
 */
export function buildRoomTranscriptRows(
  messages: readonly ChatRoomMessage[],
  transcript: Pick<RoomTranscript, "rangeEdges" | "oldestHasMore">,
): RoomTranscriptRow[] {
  const rows: RoomTranscriptRow[] = [];
  const { rangeEdges, oldestHasMore } = transcript;
  let edgeIndex = 0;
  let hasRowAbove = false;
  for (const message of messages) {
    const key = keyOf(message);
    let reachedEdge = -1;
    for (
      let edge = rangeEdges[edgeIndex];
      edge && compareKeys(edge, key) <= 0;
      edge = rangeEdges[edgeIndex]
    ) {
      reachedEdge = edgeIndex;
      edgeIndex += 1;
    }
    if (reachedEdge > 0 || (reachedEdge === 0 && oldestHasMore)) {
      // A gap only when a row is on screen above it. A range whose rows were
      // all deleted leaves the next range as the oldest thing on screen, and
      // what is missing above it reads as older history, not a gap.
      rows.push({
        kind: "boundary",
        cursorMessageId: message.id,
        isGap: hasRowAbove,
      });
    }
    rows.push({ kind: "message", message });
    hasRowAbove = true;
  }
  return rows;
}

/**
 * Day separators still read across a gap. Continuation chrome must not: a
 * first head row after "Messages are missing here" is a new burst, even when
 * the sender and the clock would otherwise group it with the jump window.
 */
export function withTranscriptRowNeighbors(
  rows: readonly RoomTranscriptRow[],
): RoomTranscriptRenderRow[] {
  let previousMessage: ChatRoomMessage | undefined;
  let dayPreviousMessage: ChatRoomMessage | undefined;
  return rows.map((row) => {
    if (row.kind === "boundary") {
      previousMessage = undefined;
      return row;
    }
    const withNeighbors = { ...row, previousMessage, dayPreviousMessage };
    previousMessage = row.message;
    dayPreviousMessage = row.message;
    return withNeighbors;
  });
}

interface LoadedRange {
  edge: MessageOrderKey;
  newest: MessageOrderKey;
}

function keyOf(message: ChatRoomMessage): MessageOrderKey {
  return { time: new Date(message.createdAt).getTime(), id: message.id };
}

function compareKeys(left: MessageOrderKey, right: MessageOrderKey): number {
  if (left.time !== right.time) {
    return left.time - right.time;
  }
  return left.id.localeCompare(right.id);
}

/** Ranges as closed intervals over the current rows. Empty ranges vanish. */
function loadedRanges(transcript: RoomTranscript): LoadedRange[] {
  const ranges: LoadedRange[] = [];
  const { messages, rangeEdges } = transcript;
  let position = 0;
  rangeEdges.forEach((edge, index) => {
    const nextEdge = rangeEdges[index + 1];
    for (
      let row = messages[position];
      row && compareKeys(keyOf(row), edge) < 0;
      row = messages[position]
    ) {
      position += 1;
    }
    let newest: MessageOrderKey | null = null;
    for (let row = messages[position]; row; row = messages[position]) {
      const key = keyOf(row);
      if (nextEdge && compareKeys(key, nextEdge) >= 0) {
        break;
      }
      newest = key;
      position += 1;
    }
    if (newest) {
      ranges.push({ edge, newest });
    }
  });
  return ranges;
}

function mergeContiguousRange(
  transcript: RoomTranscript,
  page: RoomTranscriptPage,
  reachesPresent: boolean,
): RoomTranscript {
  const hasMoreOlder = page.nextCursor != null;
  const messages = mergeRoomMessages(transcript.messages, page.messages);
  const sortedPage = page.messages.toSorted((left, right) =>
    compareKeys(keyOf(left), keyOf(right)),
  );
  const first = sortedPage[0];
  const last = sortedPage[sortedPage.length - 1];

  if (!first || !last) {
    if (reachesPresent && transcript.rangeEdges.length === 0) {
      const firstRow = messages[0];
      return {
        messages,
        rangeEdges: firstRow ? [keyOf(firstRow)] : [],
        oldestHasMore: hasMoreOlder,
      };
    }
    return { ...transcript, messages };
  }

  const windowOldest = keyOf(first);
  const windowNewest = keyOf(last);
  const existing = loadedRanges(transcript);
  const kept: MessageOrderKey[] = [];
  let newEdge = windowOldest;
  let edgeFromWindow = true;
  for (const range of existing) {
    const overlaps =
      (reachesPresent || compareKeys(range.edge, windowNewest) <= 0) &&
      compareKeys(range.newest, windowOldest) >= 0;
    if (!overlaps) {
      kept.push(range.edge);
      continue;
    }
    if (compareKeys(range.edge, newEdge) < 0) {
      newEdge = range.edge;
      edgeFromWindow = false;
    }
  }

  const insertAt = kept.findIndex((edge) => compareKeys(edge, newEdge) > 0);
  const index = insertAt < 0 ? kept.length : insertAt;
  const rangeEdges = [...kept.slice(0, index), newEdge, ...kept.slice(index)];

  if (index === 0) {
    return {
      messages,
      rangeEdges,
      oldestHasMore: edgeFromWindow ? hasMoreOlder : transcript.oldestHasMore,
    };
  }
  if (edgeFromWindow && !hasMoreOlder) {
    // Core has nothing older than this range, yet a loaded range sits above
    // it: nothing is missing between them, so they are one range.
    rangeEdges.splice(index, 1);
  }
  return { messages, rangeEdges, oldestHasMore: transcript.oldestHasMore };
}
