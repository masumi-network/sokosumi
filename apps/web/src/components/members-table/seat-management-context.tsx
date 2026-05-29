"use client";

import { createContext, type ReactNode, useContext } from "react";

interface SeatManagementContextValue {
  showSeatManagement: boolean;
  unusedSeats: number;
}

const SeatManagementContext = createContext<SeatManagementContextValue>({
  showSeatManagement: false,
  unusedSeats: 0,
});

export function SeatManagementContextProvider({
  children,
  showSeatManagement,
  unusedSeats,
}: {
  children: ReactNode;
  showSeatManagement: boolean;
  unusedSeats: number;
}) {
  return (
    <SeatManagementContext
      value={{
        showSeatManagement,
        unusedSeats,
      }}
    >
      {children}
    </SeatManagementContext>
  );
}

export function useSeatManagementContext(): SeatManagementContextValue {
  return useContext(SeatManagementContext);
}
