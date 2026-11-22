import { act, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { parseCapTableMock } = vi.hoisted(() => ({
  parseCapTableMock: vi.fn(),
}));

vi.mock("@/lib/cap-table-file", () => ({
  parseCapTable: parseCapTableMock,
}));

import type { CapTable } from "@/lib/cap-table-file";
import {
  type CapTableFileLoadState,
  useCapTableFile,
} from "./use-cap-table-file";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const SAMPLE_CAP_TABLE: CapTable = {
  kind: "sokosumi.cap-table",
  version: 1,
  company: "Acme",
  asOf: "2026-11-22",
  holders: [{ name: "Founders", shares: 1000, shareClass: "Common" }],
  pools: [],
};

describe("useCapTableFile", () => {
  afterEach(() => {
    parseCapTableMock.mockReset();
    vi.unstubAllGlobals();
  });

  it("fetches and parses cap table, aborts on url change, handles failures, and aborts on unmount", async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    const signals: AbortSignal[] = [];

    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.signal) signals.push(init.signal);
      return signals.length === 1 ? first.promise : second.promise;
    });
    vi.stubGlobal("fetch", fetchMock);
    parseCapTableMock.mockReturnValue(SAMPLE_CAP_TABLE);

    const captured: { state: CapTableFileLoadState } = {
      state: { status: "loading" },
    };

    function Probe({ url }: { url: string }) {
      captured.state = useCapTableFile(url);
      return null;
    }

    const { rerender, unmount } = render(
      <Probe url="https://files.example.com/a.captable.json" />,
    );
    expect(captured.state).toEqual({ status: "loading" });

    rerender(<Probe url="https://files.example.com/b.captable.json" />);
    expect(signals[0]?.aborted).toBe(true);

    await act(async () => {
      second.resolve(new Response(JSON.stringify(SAMPLE_CAP_TABLE)));
      await second.promise;
    });

    await waitFor(() => {
      expect(captured.state).toEqual({
        status: "ready",
        capTable: SAMPLE_CAP_TABLE,
      });
    });

    unmount();
    expect(signals[1]?.aborted).toBe(true);
  });
});
