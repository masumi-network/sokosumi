"use client";

import { type RefObject, useEffect, useState } from "react";

export function useAdsCampaignSavedReset(
  savedRef: RefObject<boolean>,
  onStartOver?: () => void,
) {
  const [saved, setSaved] = useState(false);

  // Next keeps a visited page mounted but hidden and re-runs its effects when
  // it shows again. After a save, the page starts over (a create empty, an
  // edit as it was); an unsent draft stays.
  useEffect(() => {
    if (!savedRef.current) return;
    savedRef.current = false;
    setSaved(false);
    onStartOver?.();
  }, []);

  function markSaved() {
    savedRef.current = true;
    setSaved(true);
  }

  return { saved, markSaved };
}
