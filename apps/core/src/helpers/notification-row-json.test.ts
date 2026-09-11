import { beforeEach, describe, expect, it, vi } from "vitest";

const { captureExceptionMock } = vi.hoisted(() => ({
  captureExceptionMock: vi.fn(),
}));

vi.mock("@sentry/node", () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
}));

/**
 * A fresh module per test.
 *
 * The reader remembers the rows it has named for the life of the module, so
 * tests sharing one instance would read each other's memory: the second test
 * to name a row would assert against a silence the first one caused.
 */
async function freshReader() {
  vi.resetModules();
  captureExceptionMock.mockClear();
  const { readNotificationRowJson } = await import("./notification-row-json");

  return readNotificationRowJson;
}

function reportedRowIds(): unknown[] {
  return captureExceptionMock.mock.calls.map(
    (call) => (call[1] as { extra?: { rowId?: unknown } })?.extra?.rowId,
  );
}

describe("readNotificationRowJson", () => {
  beforeEach(() => {
    captureExceptionMock.mockReset();
  });

  it("hands back the object a column parses into", async () => {
    const read = await freshReader();

    expect(read('{"count":4}', "row_1", "messageParams")).toEqual({ count: 4 });
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it("says nothing about an object that is missing the field asked for", async () => {
    const read = await freshReader();

    expect(read("{}", "row_1", "messageParams")).toEqual({});
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  /**
   * The two columns are damaged independently, and a row can carry one that
   * will not read and one that will. Naming the row alone would let the
   * second column's damage ride on the first column's report and never be
   * said, for the life of the process.
   */
  it("names both columns of one row, not just the first to fail", async () => {
    const read = await freshReader();

    expect(read("{oh no", "row_1", "messageParams")).toBeNull();
    expect(read("{oh no", "row_1", "metadata")).toBeNull();

    expect(captureExceptionMock).toHaveBeenCalledTimes(2);
    expect(
      captureExceptionMock.mock.calls.map(
        (call) => (call[1] as { extra?: { field?: unknown } })?.extra?.field,
      ),
    ).toEqual(["messageParams", "metadata"]);
  });

  it("names one column of one row once, however often it is read", async () => {
    const read = await freshReader();

    read("{oh no", "row_1", "messageParams");
    read("{oh no", "row_1", "messageParams");
    read("{oh no", "row_1", "messageParams");

    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
  });

  /**
   * A defect that damages rows in bulk must not be able to turn this into the
   * only thing the process reports. Five hundred rows in, the point is made.
   */
  it("stops naming rows once it has named five hundred", async () => {
    const read = await freshReader();

    for (let row = 0; row < 500; row += 1) {
      read("{oh no", `row_${row}`, "messageParams");
    }
    expect(captureExceptionMock).toHaveBeenCalledTimes(500);

    read("{oh no", "row_500", "messageParams");

    expect(captureExceptionMock).toHaveBeenCalledTimes(500);
    expect(reportedRowIds()).not.toContain("row_500");
  });

  it.each(["null", "12", '"a string"'])(
    "names a column that parses into %s, which no reader can take a field off",
    async (json) => {
      const read = await freshReader();

      expect(read(json, "row_1", "messageParams")).toBeNull();
      expect(captureExceptionMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "A notification row will not read: it is not an object",
        }),
        expect.objectContaining({
          extra: expect.objectContaining({ rowId: "row_1" }),
        }),
      );
    },
  );

  it("says why a column would not read without quoting it", async () => {
    const read = await freshReader();

    read("door code 4417, written raw into the column", "row_1", "metadata");

    const said = captureExceptionMock.mock.calls
      .flat()
      .map((argument) =>
        argument instanceof Error
          ? `${argument.message} ${argument.stack}`
          : JSON.stringify(argument),
      )
      .join(" ");
    expect(said).toContain("A notification row will not read: SyntaxError");
    expect(said).not.toContain("door code");
  });
});
