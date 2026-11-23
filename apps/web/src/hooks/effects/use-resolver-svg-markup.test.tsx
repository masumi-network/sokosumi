import { act, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("dompurify", () => ({
  __esModule: true,
  default: {
    sanitize: vi.fn((svg: string) => svg),
  },
}));

import {
  type ResolvedSvgMarkup,
  useResolverSvgMarkup,
} from "./use-resolver-svg-markup";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useResolverSvgMarkup", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches, sanitizes, and colorizes SVG markup, aborts on url change, and clears on non-SVG", async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    const signals: AbortSignal[] = [];

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((_input, init) => {
        if (init?.signal) signals.push(init.signal);
        return signals.length === 1 ? first.promise : second.promise;
      });

    const captured: { value: ResolvedSvgMarkup | null } = { value: null };

    function Probe({ svgUrl }: { svgUrl: string | null }) {
      captured.value = useResolverSvgMarkup(svgUrl);
      return null;
    }

    const { rerender, unmount } = render(
      <Probe svgUrl="https://cdn.example.com/a.svg" />,
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Changing svgUrl aborts the previous request and ignores its late response.
    rerender(<Probe svgUrl="https://cdn.example.com/b.svg" />);
    expect(signals[0]?.aborted).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    await act(async () => {
      second.resolve(
        new Response(
          '<svg width="24" height="24" fill="#ff0000" stroke="none"><path d="M0 0" fill="#123456" /></svg>',
          { headers: { "content-type": "image/svg+xml" } },
        ),
      );
      await second.promise;
    });

    await waitFor(() => {
      expect(captured.value?.url).toBe("https://cdn.example.com/b.svg");
    });
    expect(captured.value?.markup).toContain('fill="currentColor"');
    expect(captured.value?.markup).toContain('stroke="none"');
    expect(captured.value?.markup).toContain(
      'preserveAspectRatio="xMidYMid meet"',
    );
    expect(captured.value?.markup).not.toContain('width="24"');

    // Late resolution of aborted first request does not overwrite state.
    await act(async () => {
      first.resolve(
        new Response("<svg><rect /></svg>", {
          headers: { "content-type": "image/svg+xml" },
        }),
      );
      await first.promise;
    });
    expect(captured.value?.url).toBe("https://cdn.example.com/b.svg");

    unmount();
  });

  it("aborts in-flight fetch on unmount without updating state", async () => {
    const pending = deferred<Response>();
    let capturedSignal: AbortSignal | undefined;

    vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
      capturedSignal = init?.signal ?? undefined;
      return pending.promise;
    });

    function Probe({ svgUrl }: { svgUrl: string | null }) {
      useResolverSvgMarkup(svgUrl);
      return null;
    }

    const { unmount } = render(
      <Probe svgUrl="https://cdn.example.com/pending.svg" />,
    );
    expect(capturedSignal?.aborted).toBe(false);

    unmount();
    expect(capturedSignal?.aborted).toBe(true);

    await act(async () => {
      pending.resolve(
        new Response("<svg></svg>", {
          headers: { "content-type": "image/svg+xml" },
        }),
      );
      await pending.promise;
    });
  });
});
