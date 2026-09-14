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
  resetKey,
  onRender,
}: {
  resetKey: string;
  onRender?: (state: DisclosureState) => void;
}) {
  const { expanded, toggleExpanded, overflows, contentRef } =
    useClampedOverflow(resetKey);
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
  resetKey = "message-1\0original",
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

  it("collapses changed content and keeps separate transcripts independent", () => {
    const first = render(<Transcript />);
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    first.rerender(<Transcript resetKey="message-1\0edited" />);
    expect(
      screen.getByRole("button", { name: "Show more" }),
    ).toBeInTheDocument();
    first.unmount();

    render(<Transcript />);
    expect(
      screen.getByRole("button", { name: "Show more" }),
    ).toBeInTheDocument();
  });
});
