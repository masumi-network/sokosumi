"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * What `load` resolves to, read when the component mounts and again whenever
 * `load` changes (pass a `useCallback` over its inputs). A load that resolves
 * after a newer one started is dropped. `failed` is true when it rejected or
 * resolved to null; `reload` asks again.
 */
export function useLoaded<T>(load: () => Promise<T | null>): {
  value: T | null;
  failed: boolean;
  reload: () => void;
} {
  const [value, setValue] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);
  const [round, setRound] = useState(0);
  const reload = useCallback(() => setRound((n) => n + 1), []);

  useEffect(() => {
    void round;
    let current = true;
    setFailed(false);
    load()
      .then((loaded) => {
        if (!current) return;
        if (loaded === null) setFailed(true);
        else setValue(loaded);
      })
      .catch(() => {
        if (current) setFailed(true);
      });
    return () => {
      current = false;
    };
  }, [load, round]);

  return { value, failed, reload };
}
