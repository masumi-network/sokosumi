"use client";

import { createContext, useContext } from "react";

export const OrganizationSeatContext = createContext(false);

export function useHasAssignedOrganizationSeat(): boolean {
  return useContext(OrganizationSeatContext);
}
