import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useAccountSummaryOpenState } from "./use-account-summary-open-state";

describe("useAccountSummaryOpenState", () => {
  it("bumps menuInstance only when opening, not when closing", () => {
    const { result } = renderHook(() => useAccountSummaryOpenState());

    expect(result.current.isOpen).toBe(false);
    expect(result.current.menuInstance).toBe(0);

    act(() => {
      result.current.handleOpenChange(true);
    });
    expect(result.current.isOpen).toBe(true);
    expect(result.current.menuInstance).toBe(1);

    act(() => {
      result.current.closeMenu();
    });
    expect(result.current.isOpen).toBe(false);
    expect(result.current.menuInstance).toBe(1);

    act(() => {
      result.current.handleOpenChange(false);
    });
    expect(result.current.isOpen).toBe(false);
    expect(result.current.menuInstance).toBe(1);

    act(() => {
      result.current.handleOpenChange(true);
    });
    expect(result.current.isOpen).toBe(true);
    expect(result.current.menuInstance).toBe(2);
  });
});
