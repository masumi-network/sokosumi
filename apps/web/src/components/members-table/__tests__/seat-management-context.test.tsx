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
});
