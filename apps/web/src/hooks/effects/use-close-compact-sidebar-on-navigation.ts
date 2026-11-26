"use client";

import { usePathname } from "next/navigation";
import { useEffect, useEffectEvent, useRef } from "react";

export function useCloseCompactSidebarOnNavigation(
  isCompact: boolean,
  setOpen: (open: boolean) => void,
) {
  const pathname = usePathname();
  const previousPathname = useRef(pathname);
  const close = useEffectEvent(() => {
    if (isCompact) setOpen(false);
  });

  useEffect(() => {
    if (previousPathname.current === pathname) return;
    previousPathname.current = pathname;
    close();
  }, [pathname]);
}
