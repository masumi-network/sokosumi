"use client";

import { useEffect, useState } from "react";

import type { Coworker } from "@/app/chat/utils/types";

interface UseCoworkersReturn {
  coworkers: Coworker[];
}

/**
 * Keeps coworker state in sync with server-hydrated coworkers.
 */
export function useCoworkers(initialCoworkers: Coworker[]): UseCoworkersReturn {
  const [coworkers, setCoworkers] = useState<Coworker[]>(initialCoworkers);

  useEffect(() => {
    setCoworkers(initialCoworkers);
  }, [initialCoworkers]);

  return { coworkers };
}
