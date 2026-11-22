import { act, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { readSpreadsheetMock } = vi.hoisted(() => ({
  readSpreadsheetMock: vi.fn(),
}));

vi.mock("@/lib/spreadsheet-file", () => ({
  readSpreadsheet: readSpreadsheetMock,
}));

import type { Spreadsheet } from "@/lib/spreadsheet-file";
import {
  type SpreadsheetFileLoadState,
  useSpreadsheetFile,
} from "./use-spreadsheet-file";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const SAMPLE_SHEETS: Spreadsheet[] = [
  {
    name: "Sheet1",
    rows: [[{ text: "A1", bold: false, numeric: false }]],
    images: [],
    truncated: false,
  },
];

describe("useSpreadsheetFile", () => {
  afterEach(() => {
    readSpreadsheetMock.mockReset();
    vi.unstubAllGlobals();
  });

  it("fetches and parses spreadsheets, aborts on url/kind change, marks empty sheets failed, and aborts on unmount", async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    const signals: AbortSignal[] = [];

    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.signal) signals.push(init.signal);
      return signals.length === 1 ? first.promise : second.promise;
    });
    vi.stubGlobal("fetch", fetchMock);
    readSpreadsheetMock.mockResolvedValue(SAMPLE_SHEETS);

    const captured: { state: SpreadsheetFileLoadState } = {
      state: { status: "loading" },
    };

    function Probe({ url, kind }: { url: string; kind: "xlsx" | "csv" }) {
      captured.state = useSpreadsheetFile(url, kind);
      return null;
    }

    const { rerender, unmount } = render(
      <Probe url="https://files.example.com/a.csv" kind="csv" />,
    );
    expect(captured.state).toEqual({ status: "loading" });

    rerender(<Probe url="https://files.example.com/a.xlsx" kind="xlsx" />);
    expect(signals[0]?.aborted).toBe(true);

    await act(async () => {
      second.resolve(new Response(new Uint8Array([1, 2, 3])));
      await second.promise;
    });

    await waitFor(() => {
      expect(captured.state).toEqual({
        status: "ready",
        sheets: SAMPLE_SHEETS,
      });
    });

    unmount();
    expect(signals[1]?.aborted).toBe(true);
  });
});
