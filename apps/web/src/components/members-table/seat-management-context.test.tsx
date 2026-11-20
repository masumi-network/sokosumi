import { act, renderHook } from "@testing-library/react";
import { type ReactNode } from "react";
import { describe, expect, it } from "vitest";

import {
  SeatManagementContextProvider,
  useSeatManagementContext,
} from "@/components/members-table/seat-management-context";

function createWrapper(unusedSeats: number) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <SeatManagementContextProvider
        showSeatManagement
        unusedSeats={unusedSeats}
      >
        {children}
      </SeatManagementContextProvider>
    );
  };
}

describe("SeatManagementContextProvider", () => {
  it("rejects a second assign before re-render when only one seat remains", () => {
    const { result } = renderHook(() => useSeatManagementContext(), {
      wrapper: createWrapper(1),
    });

    let firstAccepted = false;
    let secondAccepted = false;

    act(() => {
      firstAccepted = result.current.tryBeginSeatAssign("member-a");
      secondAccepted = result.current.tryBeginSeatAssign("member-b");
    });

    expect(firstAccepted).toBe(true);
    expect(secondAccepted).toBe(false);
    expect(result.current.unusedSeats).toBe(0);
    expect(result.current.isMemberSeatAssigned("member-a", false)).toBe(true);
    expect(result.current.isMemberSeatAssigned("member-b", false)).toBe(false);
  });

  it("accepts a second assign in a later click while seats remain", () => {
    const { result } = renderHook(() => useSeatManagementContext(), {
      wrapper: createWrapper(4),
    });

    let firstAccepted = false;
    let secondAccepted = false;

    act(() => {
      firstAccepted = result.current.tryBeginSeatAssign("member-a");
    });
    act(() => {
      secondAccepted = result.current.tryBeginSeatAssign("member-b");
    });

    expect(firstAccepted).toBe(true);
    expect(secondAccepted).toBe(true);
    expect(result.current.unusedSeats).toBe(2);
  });

  it("re-enables seat assignment when canceled in the same tick", () => {
    const { result } = renderHook(() => useSeatManagementContext(), {
      wrapper: createWrapper(1),
    });

    let firstAccepted = false;
    let secondAccepted = false;

    act(() => {
      firstAccepted = result.current.tryBeginSeatAssign("member-a");
      result.current.cancelSeatAssign("member-a");
      secondAccepted = result.current.tryBeginSeatAssign("member-b");
    });

    expect(firstAccepted).toBe(true);
    expect(secondAccepted).toBe(true);
    expect(result.current.unusedSeats).toBe(0);
    expect(result.current.isMemberSeatAssigned("member-a", false)).toBe(false);
    expect(result.current.isMemberSeatAssigned("member-b", false)).toBe(true);
  });

  it("resets optimistic state and uses the new count when server unusedSeats changes", () => {
    let serverUnusedSeats = 1;
    const { result, rerender } = renderHook(() => useSeatManagementContext(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <SeatManagementContextProvider
          showSeatManagement
          unusedSeats={serverUnusedSeats}
        >
          {children}
        </SeatManagementContextProvider>
      ),
    });

    act(() => {
      expect(result.current.tryBeginSeatAssign("member-a")).toBe(true);
    });
    expect(result.current.unusedSeats).toBe(0);

    serverUnusedSeats = 2;
    rerender();

    expect(result.current.unusedSeats).toBe(2);
    expect(result.current.isMemberSeatAssigned("member-a", false)).toBe(false);

    act(() => {
      expect(result.current.tryBeginSeatAssign("member-b")).toBe(true);
      expect(result.current.tryBeginSeatAssign("member-c")).toBe(true);
      expect(result.current.tryBeginSeatAssign("member-d")).toBe(false);
    });
    expect(result.current.unusedSeats).toBe(0);
  });
});
