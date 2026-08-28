"use client";

import { createContext, type ReactNode, useContext } from "react";

const OrganizationSeatContext = createContext(false);

export function OrganizationSeatProvider({
  hasAssignedSeat,
  children,
}: {
  hasAssignedSeat: boolean;
  children: ReactNode;
}) {
  return (
    <OrganizationSeatContext.Provider value={hasAssignedSeat}>
      {children}
    </OrganizationSeatContext.Provider>
  );
}

export function useHasAssignedOrganizationSeat(): boolean {
  return useContext(OrganizationSeatContext);
}
