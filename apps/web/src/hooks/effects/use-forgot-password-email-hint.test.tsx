import { renderHook } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { rememberAuthEmailHint } from "@/lib/auth/auth-email-hint";
import { useForgotPasswordEmailHint } from "./use-forgot-password-email-hint";

describe("useForgotPasswordEmailHint", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  afterEach(() => {
    window.sessionStorage.clear();
  });

  it("consumes the stored email hint on mount and fills the form field once", () => {
    rememberAuthEmailHint("alice@example.com");
    const setValue = vi.fn();

    const { rerender } = renderHook(
      ({ tick }: { tick: number }) => {
        void tick;
        useForgotPasswordEmailHint({ setValue });
      },
      { initialProps: { tick: 0 } },
    );

    expect(setValue).toHaveBeenCalledTimes(1);
    expect(setValue).toHaveBeenCalledWith("email", "alice@example.com");

    // Re-rendering does not re-read storage.
    rememberAuthEmailHint("bob@example.com");
    rerender({ tick: 1 });
    expect(setValue).toHaveBeenCalledTimes(1);
  });

  it("skips setValue when no email hint is stored and does not throw during SSR", () => {
    const setValue = vi.fn();
    renderHook(() => useForgotPasswordEmailHint({ setValue }));
    expect(setValue).not.toHaveBeenCalled();

    function Probe() {
      useForgotPasswordEmailHint({ setValue });
      return <span>ok</span>;
    }

    expect(renderToString(<Probe />)).toBe("<span>ok</span>");
  });
});
