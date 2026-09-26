/**
 * Answers the two raw reads a room summary makes about what is unread.
 *
 * Both go through `$queryRawUnsafe`, so a test that mocks it with one value
 * would hand count rows to the unread Threads read. `rows` answers the count;
 * `threads` answers the unread Threads read, which runs only for rooms whose
 * counts show Thread unread.
 *
 * The two reads are told apart by a column only the second selects. It is the
 * one place a test depends on the SQL's text; keep it here.
 */
export function answerRoomUnreadReads(
  queryRawUnsafeMock: {
    mockImplementation: (fn: (sql: string) => Promise<unknown>) => unknown;
  },
  rows: Array<Record<string, unknown>>,
  threads: Array<Record<string, unknown>> = [],
): void {
  queryRawUnsafeMock.mockImplementation(async (sql: string) =>
    sql.includes('"firstUnreadReplyId"') ? threads : rows,
  );
}
