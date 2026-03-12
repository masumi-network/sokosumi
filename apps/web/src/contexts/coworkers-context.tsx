"use client";

import { createContext, useContext } from "react";

import { useCoworkers } from "@/app/chat/hooks/use-coworkers";
import type { Coworker } from "@/app/chat/utils/types";

export interface CoworkersContextValue {
  coworkers: Coworker[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

const CoworkersContext = createContext<CoworkersContextValue | null>(null);

interface CoworkersProviderProps {
  children: React.ReactNode;
  initialCoworkers: Coworker[];
}

export function CoworkersProvider({
  children,
  initialCoworkers,
}: CoworkersProviderProps) {
  const value = useCoworkers(initialCoworkers);
  return (
    <CoworkersContext.Provider value={value}>
      {children}
    </CoworkersContext.Provider>
  );
}

export function useCoworkersContext(): CoworkersContextValue {
  const context = useContext(CoworkersContext);
  if (!context) {
    throw new Error(
      "useCoworkersContext must be used within a CoworkersProvider",
    );
  }
  return context;
}
