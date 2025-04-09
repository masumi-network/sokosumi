"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";

export function useAsyncRouterPush() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [resolve, setResolve] = useState<(() => void) | null>(null);
  const [isTriggered, setIsTriggered] = useState(false);

  useEffect(() => {
    if (isTriggered && !isPending) {
      if (resolve) {
        resolve();
        setIsTriggered(false);
        setResolve(null);
      }
    }
    if (isPending) {
      setIsTriggered(true);
    }
  }, [isTriggered, isPending, resolve]);

  const asyncRouter = useMemo(() => {
    const push = (path: string) => {
      return new Promise((resolve, _reject) => {
        setResolve(() => resolve);
        startTransition(() => {
          router.push(path);
        });
      });
    };
    return { ...router, push };
  }, [router]);

  return asyncRouter;
}
