"use client";

import { usePathname, useSearchParams } from "next/navigation";
import {
  createContext,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { setUTMCookieIfNotExists } from "@/lib/actions/utm/action";
import { extractUTMParams, type UTMData } from "@/lib/utils/utm";

interface UTMContextValue {
  utmData: UTMData | null;
}

const UTMContext = createContext<UTMContextValue>({ utmData: null });

interface UTMProviderProps {
  children: React.ReactNode;
}

export function UTMProviderInner({ children }: UTMProviderProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [utmData, setUTMData] = useState<UTMData | null>(null);

  const utmParams = useMemo(
    () => extractUTMParams(searchParams),
    [searchParams],
  );

  const setUTMCookie = useCallback(
    async (data: UTMData) => {
      const result = await setUTMCookieIfNotExists(data);
      if (result.ok) {
        setUTMData(result.data);
      }
    },
    [setUTMData],
  );

  useEffect(() => {
    if (utmData) {
      return;
    }

    if (utmParams) {
      const utmData: UTMData = {
        ...utmParams,
        referrer: document.referrer || undefined,
        landingPage: pathname,
        capturedAt: new Date().toISOString(),
      };

      // Set UTM cookie
      setUTMCookie(utmData);
    }
  }, [pathname, utmParams, utmData, setUTMCookie]);

  return (
    <UTMContext.Provider value={{ utmData }}>{children}</UTMContext.Provider>
  );
}

export function UTMProvider({ children }: UTMProviderProps) {
  return (
    <Suspense>
      <UTMProviderInner>{children}</UTMProviderInner>
    </Suspense>
  );
}

export function useUTM() {
  const context = useContext(UTMContext);
  if (context === undefined) {
    throw new Error("useUTM must be used within a UTMProvider");
  }
  return context;
}
