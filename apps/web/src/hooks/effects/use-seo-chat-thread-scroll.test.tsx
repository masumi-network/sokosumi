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
}: {
  follow: string;
  landed: boolean;
  withArticle?: boolean;
  scrollHeight?: number;
  articleOffsetTop?: number;
}) {
  const thread = useRef<HTMLDivElement>(null);
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

  it("re-applies scrollTop on follow change, StrictMode replay, and Activity reveal", () => {
    const { rerender, unmount } = render(
      <StrictMode>
        <Activity mode="visible">
          <ThreadHarness follow="t1:running:true" landed={false} />
        </Activity>
      </StrictMode>,
    );
    const box = screen.getByTestId("thread");
    expect(box.scrollTop).toBe(500);

    box.scrollTop = 10;
    rerender(
      <StrictMode>
        <Activity mode="visible">
          <ThreadHarness follow="t2:running:true" landed={false} />
        </Activity>
      </StrictMode>,
    );
    expect(box.scrollTop).toBe(500);

    box.scrollTop = 42;
    rerender(
      <StrictMode>
        <Activity mode="hidden">
          <ThreadHarness follow="t2:running:true" landed={false} />
        </Activity>
      </StrictMode>,
    );
    expect(box.scrollTop).toBe(42);

    rerender(
      <StrictMode>
        <Activity mode="visible">
          <ThreadHarness follow="t2:running:true" landed={false} />
        </Activity>
      </StrictMode>,
    );
    expect(box.scrollTop).toBe(500);

    unmount();
  });
});
