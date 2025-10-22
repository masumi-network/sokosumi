"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useTransition } from "react";

export function useAsyncRouter() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const resolveRef = useRef<(() => void) | null>(null);
  const wasTransitionStartedRef = useRef(false);

  useEffect(() => {
    // When transition completes and we have a pending resolve, call it
    if (wasTransitionStartedRef.current && !isPending && resolveRef.current) {
      resolveRef.current();
      resolveRef.current = null;
      wasTransitionStartedRef.current = false;
    }
  }, [isPending]);

  const asyncRouter = useMemo(() => {
    const push = (path: string) => {
      return new Promise<void>((resolve) => {
        resolveRef.current = resolve;
        wasTransitionStartedRef.current = true;
        startTransition(() => {
          router.push(path);
        });
      });
    };
    return { ...router, push };
  }, [router]);

  return asyncRouter;
}
