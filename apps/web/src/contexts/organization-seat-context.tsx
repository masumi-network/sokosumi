"use client";

import { createContext, type ReactNode, useContext } from "react";

export const OrganizationSeatContext = createContext(false);

export function OrganizationSeatProvider({
  hasAssignedSeat,
  children,
}: {
  hasAssignedSeat: boolean;
  children: ReactNode;
}) {
  return (
    <OrganizationSeatContext value={hasAssignedSeat}>
      {children}
    </OrganizationSeatContext>
  );
}

export function useHasAssignedOrganizationSeat(): boolean {
  return useContext(OrganizationSeatContext);
}
