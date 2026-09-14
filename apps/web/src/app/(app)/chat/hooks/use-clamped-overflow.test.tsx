import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ClampedOverflowProvider,
  useClampedOverflow,
} from "./use-clamped-overflow";

interface DisclosureState {
  expanded: boolean;
  overflows: boolean;
}

function Message({
  cacheKey = "body:message-1",
  resetKey,
  onRender,
}: {
  cacheKey?: string;
  resetKey: string;
  onRender?: (state: DisclosureState) => void;
}) {
  const { expanded, toggleExpanded, overflows, contentRef } =
    useClampedOverflow({ cacheKey, resetKey });
  onRender?.({ expanded, overflows });
  return (
    <div>
      <div ref={contentRef}>Long message</div>
      <button type="button" onClick={toggleExpanded}>
        {expanded ? "Show less" : "Show more"}
      </button>
    </div>
  );
}

function Transcript({
  visible = true,
  resetKey = "original",
  onRender,
}: {
  visible?: boolean;
  resetKey?: string;
  onRender?: (state: DisclosureState) => void;
}) {
  return (
    <ClampedOverflowProvider>
      {visible ? <Message resetKey={resetKey} onRender={onRender} /> : null}
    </ClampedOverflowProvider>
  );
}

afterEach(() => vi.restoreAllMocks());

describe("useClampedOverflow", () => {
  it("restores expansion before a virtualized row is measured on remount", () => {
    const onRender = vi.fn();
    const { rerender } = render(<Transcript onRender={onRender} />);
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    rerender(<Transcript visible={false} />);
    onRender.mockClear();
    rerender(<Transcript onRender={onRender} />);

    expect(onRender.mock.calls[0][0].expanded).toBe(true);
    expect(
      screen.getByRole("button", { name: "Show less" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show less" }));
    rerender(<Transcript visible={false} />);
    rerender(<Transcript />);
    expect(
      screen.getByRole("button", { name: "Show more" }),
    ).toBeInTheDocument();
  });

  it("reserves the overflow control from the first render when a row returns", () => {
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(500);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(100);
    const onRender = vi.fn();
    const { rerender } = render(<Transcript onRender={onRender} />);
    expect(onRender.mock.lastCall?.[0].overflows).toBe(true);
    rerender(<Transcript visible={false} />);
    onRender.mockClear();
    rerender(<Transcript onRender={onRender} />);

    expect(onRender.mock.calls[0][0].overflows).toBe(true);
  });

  it("remeasures remembered overflow when the available width changes", () => {
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(500);
    const clientHeight = vi
      .spyOn(HTMLElement.prototype, "clientHeight", "get")
      .mockReturnValue(100);
    const onRender = vi.fn();
    const { rerender } = render(<Transcript onRender={onRender} />);
    rerender(<Transcript visible={false} />);
    clientHeight.mockReturnValue(500);
    rerender(<Transcript onRender={onRender} />);
    expect(onRender.mock.lastCall?.[0].overflows).toBe(false);

    rerender(<Transcript visible={false} />);
    onRender.mockClear();
    rerender(<Transcript onRender={onRender} />);
    expect(onRender.mock.calls[0][0].overflows).toBe(false);
  });

  it("collapses edited content even when it changes back to the original text", () => {
    const onRender = vi.fn();
    const { rerender } = render(<Transcript onRender={onRender} />);
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    rerender(<Transcript resetKey="edited" />);
    expect(
      screen.getByRole("button", { name: "Show more" }),
    ).toBeInTheDocument();
    onRender.mockClear();
    rerender(<Transcript onRender={onRender} />);

    expect(onRender.mock.calls[0][0].expanded).toBe(false);
    rerender(<Transcript visible={false} />);
    rerender(<Transcript />);
    expect(
      screen.getByRole("button", { name: "Show more" }),
    ).toBeInTheDocument();
  });

  it("resets expansion after a transcript unmounts", () => {
    const first = render(<Transcript />);
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    first.unmount();

    render(<Transcript />);
    expect(
      screen.getByRole("button", { name: "Show more" }),
    ).toBeInTheDocument();
  });

  it("keeps the same message independent in two live transcripts", () => {
    const onFirst = vi.fn();
    const onSecond = vi.fn();
    function Pair({ visible = true }: { visible?: boolean }) {
      return (
        <>
          <Transcript visible={visible} onRender={onFirst} />
          <Transcript visible={visible} onRender={onSecond} />
        </>
      );
    }

    const { rerender } = render(<Pair />);
    fireEvent.click(screen.getAllByRole("button", { name: "Show more" })[0]);
    rerender(<Pair visible={false} />);
    onFirst.mockClear();
    onSecond.mockClear();
    rerender(<Pair />);

    expect(onFirst.mock.calls[0][0].expanded).toBe(true);
    expect(onSecond.mock.calls[0][0].expanded).toBe(false);
  });

  it("keeps body and quote expansion independent under one transcript", () => {
    const bodyKey = "body:m1";
    const quoteKey = "quote:m1";
    const onBody = vi.fn();
    const onQuote = vi.fn();

    function Pair({ visible = true }: { visible?: boolean }) {
      return (
        <ClampedOverflowProvider>
          {visible ? (
            <>
              <Message cacheKey={bodyKey} resetKey="hello" onRender={onBody} />
              <Message
                cacheKey={quoteKey}
                resetKey="hello"
                onRender={onQuote}
              />
            </>
          ) : null}
        </ClampedOverflowProvider>
      );
    }

    const { rerender } = render(<Pair />);
    fireEvent.click(screen.getAllByRole("button", { name: "Show more" })[0]);
    rerender(<Pair visible={false} />);
    onBody.mockClear();
    onQuote.mockClear();
    rerender(<Pair />);

    expect(onBody.mock.calls[0][0].expanded).toBe(true);
    expect(onQuote.mock.calls[0][0].expanded).toBe(false);
    expect(screen.getAllByRole("button")[0]).toHaveTextContent("Show less");
    expect(screen.getAllByRole("button")[1]).toHaveTextContent("Show more");

    fireEvent.click(screen.getAllByRole("button")[0]);
    fireEvent.click(screen.getAllByRole("button")[1]);
    rerender(<Pair visible={false} />);
    onBody.mockClear();
    onQuote.mockClear();
    rerender(<Pair />);

    expect(onBody.mock.calls[0][0].expanded).toBe(false);
    expect(onQuote.mock.calls[0][0].expanded).toBe(true);
  });

  it("measures the restored expanded height on the first commit after remount", () => {
    const collapsed = 80;
    const expanded = 400;
    const measures: number[] = [];
    const offsetDescriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "offsetHeight",
    );

    function Row() {
      const { expanded: isExpanded, toggleExpanded } = useClampedOverflow({
        cacheKey: "body:m1",
        resetKey: "hello",
      });
      return (
        <div
          ref={(node) => {
            if (node) {
              measures.push(node.offsetHeight);
            }
          }}
          style={{ height: isExpanded ? expanded : collapsed }}
        >
          <button type="button" onClick={toggleExpanded}>
            {isExpanded ? "Show less" : "Show more"}
          </button>
        </div>
      );
    }

    function Harness({ visible = true }: { visible?: boolean }) {
      return (
        <ClampedOverflowProvider>
          {visible ? <Row /> : null}
        </ClampedOverflowProvider>
      );
    }

    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get(this: HTMLElement) {
        return Number.parseFloat(this.style.height || "0") || 0;
      },
    });

    try {
      const { rerender } = render(<Harness />);
      fireEvent.click(screen.getByRole("button", { name: "Show more" }));
      rerender(<Harness visible={false} />);
      measures.length = 0;
      rerender(<Harness />);
      expect(measures[0]).toBe(expanded);
    } finally {
      if (offsetDescriptor) {
        Object.defineProperty(
          HTMLElement.prototype,
          "offsetHeight",
          offsetDescriptor,
        );
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, "offsetHeight");
      }
    }
  });
});
