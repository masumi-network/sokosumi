"use client";

import { useLayoutEffect, useState } from "react";

/**
 * Open state of the job details modal. Next keeps a closed modal's route in
 * `<Activity>`, so a plain `useState(true)` comes back `false` when the reader
 * taps the same job again and nothing opens. Layout effects run again when
 * Activity shows the route, so reopen there, before paint. It stays closed
 * while hidden, so no dialog shows over the jobs list.
 */
export function useJobDetailsModalOpen(): {
  open: boolean;
  close: () => void;
} {
  const [open, setOpen] = useState(true);
  useLayoutEffect(() => {
    setOpen(true);
  }, []);

  return { open, close: () => setOpen(false) };
}
