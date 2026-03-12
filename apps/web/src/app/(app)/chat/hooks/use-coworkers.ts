"use client";

import { useCallback, useEffect, useState } from "react";

import type { Coworker } from "@/app/chat/utils/types";

interface UseCoworkersReturn {
  coworkers: Coworker[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * Keeps coworker state in sync with server-hydrated coworkers.
 */
export function useCoworkers(initialCoworkers: Coworker[]): UseCoworkersReturn {
  const [coworkers, setCoworkers] = useState<Coworker[]>(initialCoworkers);

  useEffect(() => {
    setCoworkers(initialCoworkers);
  }, [initialCoworkers]);

  const refetch = useCallback(async () => {}, []);

  return { coworkers, isLoading: false, error: null, refetch };
}
