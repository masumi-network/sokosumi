"use client";

import { useEffect } from "react";

export function useFileDetailLoad(
  load: () => Promise<void>,
  sessionPending: boolean,
): void {
  useEffect(() => {
    // Waiting costs a moment of the loading state. Not waiting asks for the
    // file in the personal drive before the active organization is known,
    // which is a request we already know the answer to.
    if (sessionPending) return;
    void load();
  }, [load, sessionPending]);
}
