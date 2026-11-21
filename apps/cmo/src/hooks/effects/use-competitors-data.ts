"use client";

import type { CmoCompetitors } from "@sokosumi/core-client";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useState,
} from "react";

export interface UseCompetitorsDataResult {
  data: CmoCompetitors | null;
  setData: Dispatch<SetStateAction<CmoCompetitors | null>>;
  failed: boolean;
  reload: () => void;
}

/**
 * Loads the Competitors tab payload on mount and whenever `loadCompetitors`
 * changes, exposing `reload` for retry and `setData` for mutations.
 */
export function useCompetitorsData(
  loadCompetitors: () => Promise<CmoCompetitors | null>,
): UseCompetitorsDataResult {
  const [data, setData] = useState<CmoCompetitors | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    let current = true;
    setFailed(false);
    loadCompetitors()
      .then((loaded) => {
        if (!current) return;
        if (loaded) setData(loaded);
        else setFailed(true);
      })
      .catch(() => {
        if (current) setFailed(true);
      });
    return () => {
      current = false;
    };
  }, [loadCompetitors]);

  useEffect(load, [load]);

  return { data, setData, failed, reload: load };
}
