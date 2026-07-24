"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

import type { Coworker } from "@/app/chat/utils/types";

export interface CoworkersContextValue {
  coworkers: Coworker[];
}

const CoworkersContext = createContext<CoworkersContextValue | null>(null);
const CoworkersHydrationContext = createContext<
  ((coworkers: Coworker[]) => void) | null
>(null);

interface CoworkersProviderProps {
  children: React.ReactNode;
  initialCoworkers: Coworker[];
}

export function CoworkersProvider({
  children,
  initialCoworkers,
}: CoworkersProviderProps) {
  // Hydrate path owns updates after mount — do not sync props via effect
  // (layout may re-pass a fresh empty array and wipe hydrated state).
  const [coworkers, setCoworkers] = useState<Coworker[]>(initialCoworkers);

  const hydrateCoworkers = useCallback((nextCoworkers: Coworker[]) => {
    setCoworkers(nextCoworkers);
  }, []);

  const value = useMemo(() => ({ coworkers }), [coworkers]);

  return (
    <CoworkersHydrationContext.Provider value={hydrateCoworkers}>
      <CoworkersContext.Provider value={value}>
        {children}
      </CoworkersContext.Provider>
    </CoworkersHydrationContext.Provider>
  );
}

export function useCoworkersHydration(): (coworkers: Coworker[]) => void {
  const hydrateCoworkers = useContext(CoworkersHydrationContext);

  if (!hydrateCoworkers) {
    throw new Error(
      "useCoworkersHydration must be used within a CoworkersProvider",
    );
  }

  return hydrateCoworkers;
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
