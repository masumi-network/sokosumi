import { render, screen } from "@testing-library/react";
import { Activity, StrictMode, useRef } from "react";
import { describe, expect, it } from "vitest";

import { useSeoChatThreadScroll } from "./use-seo-chat-thread-scroll";

function ThreadHarness({
  follow,
  landed,
  withArticle = true,
  scrollHeight = 500,
  articleOffsetTop = 240,
  onScrollTopWrite,
}: {
  follow: string;
  landed: boolean;
  withArticle?: boolean;
  scrollHeight?: number;
  articleOffsetTop?: number;
  onScrollTopWrite?: (value: number) => void;
}) {
  const thread = useRef<HTMLDivElement>(null);
  const currentScrollTop = useRef(0);
  const wiredNode = useRef<HTMLDivElement | null>(null);
  useSeoChatThreadScroll(thread, follow, landed);
  return (
    <div
      ref={(node) => {
        thread.current = node;
        if (node) {
          Object.defineProperty(node, "scrollHeight", {
            configurable: true,
            value: scrollHeight,
          });
          if (onScrollTopWrite && wiredNode.current !== node) {
            wiredNode.current = node;
            Object.defineProperty(node, "scrollTop", {
              configurable: true,
              get: () => currentScrollTop.current,
              set: (value: number) => {
                currentScrollTop.current = value;
                onScrollTopWrite(value);
              },
            });
          }
        }
      }}
      data-testid="thread"
    >
      {withArticle ? (
        <article
          ref={(node) => {
            if (node) {
              Object.defineProperty(node, "offsetTop", {
                configurable: true,
                value: articleOffsetTop,
              });
            }
          }}
        >
          Reply
        </article>
      ) : null}
    </div>
  );
}

describe("useSeoChatThreadScroll", () => {
  it("scrolls to scrollHeight while following, and to last article offset minus 16px when landed", () => {
    const { rerender, unmount } = render(
      <ThreadHarness follow="t1:running:false" landed={false} />,
    );
    const box = screen.getByTestId("thread");
    expect(box.scrollTop).toBe(500);

    rerender(<ThreadHarness follow="t1:completed:false" landed={true} />);
    expect(box.scrollTop).toBe(224);

    // Without an article element, falls back to scrollHeight even when landed.
    rerender(
      <ThreadHarness
        follow="t2:completed:false"
        landed={true}
        withArticle={false}
      />,
    );
    expect(box.scrollTop).toBe(500);

    unmount();
  });

  it("re-applies scrollTop on both StrictMode mount writes, follow change, and Activity reveal", () => {
    const writes: number[] = [];
    const recordWrite = (value: number) => {
      writes.push(value);
    };
    const { rerender, unmount } = render(
      <StrictMode>
        <Activity mode="visible">
          <ThreadHarness
            follow="t1:running:true"
            landed={false}
            onScrollTopWrite={recordWrite}
          />
        </Activity>
      </StrictMode>,
    );
    const box = screen.getByTestId("thread");
    expect(box.scrollTop).toBe(500);
    expect(writes).toEqual([500, 500]);

    writes.length = 0;
    box.scrollTop = 10;
    expect(writes).toEqual([10]);
    writes.length = 0;
    rerender(
      <StrictMode>
        <Activity mode="visible">
          <ThreadHarness
            follow="t2:running:true"
            landed={false}
            onScrollTopWrite={recordWrite}
          />
        </Activity>
      </StrictMode>,
    );
    expect(box.scrollTop).toBe(500);
    expect(writes).toEqual([500]);

    box.scrollTop = 42;
    writes.length = 0;
    rerender(
      <StrictMode>
        <Activity mode="hidden">
          <ThreadHarness
            follow="t2:running:true"
            landed={false}
            onScrollTopWrite={recordWrite}
          />
        </Activity>
      </StrictMode>,
    );
    expect(box.scrollTop).toBe(42);
    expect(writes).toEqual([]);

    rerender(
      <StrictMode>
        <Activity mode="visible">
          <ThreadHarness
            follow="t2:running:true"
            landed={false}
            onScrollTopWrite={recordWrite}
          />
        </Activity>
      </StrictMode>,
    );
    expect(box.scrollTop).toBe(500);
    expect(writes).toEqual([500, 500]);

    unmount();
  });
});
