"use client";

import { useEffect, useState } from "react";

/**
 * A `key` that changes each time the component is hidden by React Activity,
 * so a subtree keyed with it starts fresh when it is shown again. Next keeps
 * a route the reader left mounted but hidden; this drops what was typed there.
 */
export function useHiddenResetKey(): number {
  const [key, setKey] = useState(0);
  useEffect(() => () => setKey((current) => current + 1), []);
  return key;
}
