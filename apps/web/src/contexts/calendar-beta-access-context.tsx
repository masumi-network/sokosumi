"use client";

import { createContext, type ReactNode, useContext } from "react";

const CalendarBetaAccessContext = createContext(false);

export function CalendarBetaAccessProvider({
  children,
  enabled,
}: {
  children: ReactNode;
  enabled: boolean;
}) {
  return (
    <CalendarBetaAccessContext value={enabled}>
      {children}
    </CalendarBetaAccessContext>
  );
}

export function useCalendarBetaAccess(): boolean {
  return useContext(CalendarBetaAccessContext);
}
