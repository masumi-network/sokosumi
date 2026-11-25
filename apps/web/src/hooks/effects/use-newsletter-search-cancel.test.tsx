import { render } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";
import { useNewsletterSearchCancel } from "./use-newsletter-search-cancel";

function Harness({
  navKey,
  debouncedSearch,
}: {
  navKey: string;
  debouncedSearch: { cancel: () => void };
}) {
  useNewsletterSearchCancel({ navKey, debouncedSearch });
  return null;
}

describe("useNewsletterSearchCancel", () => {
  it("cancels when navKey changes and on unmount, without cancelling on initial mount", () => {
    const cancel = vi.fn();
    const { rerender, unmount } = render(
      <Harness navKey="p1\0\0" debouncedSearch={{ cancel }} />,
    );

    expect(cancel).not.toHaveBeenCalled();

    rerender(<Harness navKey="p1\0\0" debouncedSearch={{ cancel }} />);
    expect(cancel).not.toHaveBeenCalled();

    rerender(<Harness navKey="p1\0ada\0" debouncedSearch={{ cancel }} />);
    expect(cancel).toHaveBeenCalledTimes(1);

    unmount();
    expect(cancel).toHaveBeenCalledTimes(2);
  });

  it("handles StrictMode double-invoke without firing an extra navKey cancel", () => {
    const cancel = vi.fn();
    const { rerender, unmount } = render(
      <StrictMode>
        <Harness navKey="p1\0\0" debouncedSearch={{ cancel }} />
      </StrictMode>,
    );

    // StrictMode runs the unmount cleanup once during mount replay.
    expect(cancel).toHaveBeenCalledTimes(1);

    rerender(
      <StrictMode>
        <Harness navKey="p2\0\0" debouncedSearch={{ cancel }} />
      </StrictMode>,
    );
    expect(cancel).toHaveBeenCalledTimes(2);

    unmount();
    expect(cancel).toHaveBeenCalledTimes(3);
  });
});
