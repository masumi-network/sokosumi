"use client";

import { usePathname, useSearchParams } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
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

export function UTMProvider({ children }: UTMProviderProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [utmData, setUTMData] = useState<UTMData | null>(null);

  const setUTMCoookie = useCallback(
    async (data: UTMData) => {
      const result = await setUTMCookieIfNotExists(data);
      if (result.ok) {
        setUTMData(data);
      }
    },
    [setUTMData],
  );

  useEffect(() => {
    if (utmData) {
      return;
    }

    const utmParams = extractUTMParams(searchParams);

    if (utmParams) {
      const utmData: UTMData = {
        ...utmParams,
        referrer: document.referrer || undefined,
        landingPage: pathname,
        capturedAt: new Date().toISOString(),
      };

      // Set UTM cookie
      setUTMCoookie(utmData);
    }
  }, [pathname, searchParams, utmData, setUTMCoookie]);

  return (
    <UTMContext.Provider value={{ utmData }}>{children}</UTMContext.Provider>
  );
}

export function useUTM() {
  const context = useContext(UTMContext);
  if (context === undefined) {
    throw new Error("useUTM must be used within a UTMProvider");
  }
  return context;
}
