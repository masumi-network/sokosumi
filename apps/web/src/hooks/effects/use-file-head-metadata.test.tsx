import { act, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type FileHeadMetadata,
  useFileHeadMetadata,
} from "./use-file-head-metadata";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("useFileHeadMetadata", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches HEAD headers for url, aborts on url change, and suppresses late updates after unmount", async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    const signals: AbortSignal[] = [];

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((_input, init) => {
        if (init?.signal) signals.push(init.signal);
        return signals.length === 1 ? first.promise : second.promise;
      });

    const captured: { value: FileHeadMetadata | undefined } = {
      value: undefined,
    };

    function Probe({ url }: { url: string }) {
      captured.value = useFileHeadMetadata(url);
      return null;
    }

    const { rerender, unmount } = render(
      <Probe url="https://files.example.com/a.pdf" />,
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://files.example.com/a.pdf",
      expect.objectContaining({ method: "HEAD" }),
    );

    rerender(<Probe url="https://files.example.com/b.pdf" />);
    expect(signals[0]?.aborted).toBe(true);

    await act(async () => {
      second.resolve(
        new Response(null, {
          status: 200,
          headers: {
            "content-type": "application/pdf",
            "content-disposition": 'attachment; filename="report.pdf"',
            "content-length": "2048",
          },
        }),
      );
      await second.promise;
    });

    await waitFor(() => {
      expect(captured.value).toEqual({
        contentType: "application/pdf",
        fileName: "report.pdf",
        size: 2048,
      });
    });

    // Late resolution of aborted first request does not overwrite b.pdf metadata.
    await act(async () => {
      first.resolve(
        new Response(null, {
          status: 200,
          headers: { "content-type": "text/plain" },
        }),
      );
      await first.promise;
    });
    expect(captured.value?.fileName).toBe("report.pdf");

    unmount();
    expect(signals[1]?.aborted).toBe(true);
  });
});
