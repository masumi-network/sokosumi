"use client";

import { createContext, type ReactNode, useContext } from "react";

const OrganizationWorkstationContext = createContext(false);

export function OrganizationWorkstationProvider({
  canUseWorkstation,
  children,
}: {
  canUseWorkstation: boolean;
  children: ReactNode;
}) {
  return (
    <OrganizationWorkstationContext.Provider value={canUseWorkstation}>
      {children}
    </OrganizationWorkstationContext.Provider>
  );
}

export function useCanUseOrganizationWorkstation(): boolean {
  return useContext(OrganizationWorkstationContext);
}
