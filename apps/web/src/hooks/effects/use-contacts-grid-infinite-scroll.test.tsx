import { render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useContactsGridInfiniteScroll } from "./use-contacts-grid-infinite-scroll";

describe("useContactsGridInfiniteScroll", () => {
  const originalIntersectionObserver = globalThis.IntersectionObserver;

  afterEach(() => {
    globalThis.IntersectionObserver = originalIntersectionObserver;
    vi.restoreAllMocks();
  });

  it("observes sentinel when hasMore is true, re-arms when onLoadMore identity changes, and disconnects on cleanup", () => {
    const instances: Array<{
      observe: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
      trigger: (isIntersecting: boolean) => void;
    }> = [];

    class FakeIntersectionObserver {
      observe = vi.fn();
      disconnect = vi.fn();
      unobserve = vi.fn();
      takeRecords = vi.fn(() => []);
      root = null;
      rootMargin = "";
      scrollMargin = "";
      thresholds = [];

      constructor(private readonly cb: IntersectionObserverCallback) {
        instances.push({
          observe: this.observe,
          disconnect: this.disconnect,
          trigger: (isIntersecting: boolean) => {
            this.cb(
              [
                {
                  isIntersecting,
                } as IntersectionObserverEntry,
              ],
              this,
            );
          },
        });
      }
    }

    globalThis.IntersectionObserver = FakeIntersectionObserver;

    function Probe({
      hasMore,
      onLoadMore,
    }: {
      hasMore: boolean;
      onLoadMore: () => void;
    }) {
      const sentinel = useRef<HTMLTableRowElement>(null);
      useContactsGridInfiniteScroll(sentinel, hasMore, onLoadMore);
      return (
        <table>
          <tbody>
            <tr ref={sentinel} />
          </tbody>
        </table>
      );
    }

    const loadPage1 = vi.fn();
    const loadPage2 = vi.fn();

    const { rerender, unmount } = render(
      <Probe hasMore={false} onLoadMore={loadPage1} />,
    );
    expect(instances).toHaveLength(0);

    rerender(<Probe hasMore={true} onLoadMore={loadPage1} />);
    expect(instances).toHaveLength(1);
    expect(instances[0]?.observe).toHaveBeenCalledTimes(1);

    instances[0]?.trigger(false);
    expect(loadPage1).not.toHaveBeenCalled();

    instances[0]?.trigger(true);
    expect(loadPage1).toHaveBeenCalledTimes(1);

    // A fresh onLoadMore identity after page completion must disconnect and re-observe
    // so a still-visible sentinel fires again for the next page.
    rerender(<Probe hasMore={true} onLoadMore={loadPage2} />);
    expect(instances[0]?.disconnect).toHaveBeenCalledTimes(1);
    expect(instances).toHaveLength(2);
    expect(instances[1]?.observe).toHaveBeenCalledTimes(1);

    instances[1]?.trigger(true);
    expect(loadPage2).toHaveBeenCalledTimes(1);

    unmount();
    expect(instances[1]?.disconnect).toHaveBeenCalledTimes(1);
  });
});
