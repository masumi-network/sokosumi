"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { createContext, useContext, useEffect } from "react";

import { setUTMCookieIfNotExists } from "@/lib/actions/utm/action";
import { extractUTMParams, type UTMData } from "@/lib/utils/utm";

interface UTMContextValue {
  utmData: UTMData | null;
}

const UTMContext = createContext<UTMContextValue | undefined>(undefined);

interface UTMProviderProps {
  children: React.ReactNode;
}

export function UTMProvider({ children }: UTMProviderProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    const utmParams = extractUTMParams(searchParams);

    if (utmParams) {
      const utmData: UTMData = {
        ...utmParams,
        referrer: document.referrer || undefined,
        landingPage: pathname,
        capturedAt: new Date().toISOString(),
      };

      // Set UTM cookie
      setUTMCookieIfNotExists(utmData);
    }
  }, [pathname, searchParams]);

  return (
    <UTMContext.Provider value={{ utmData: null }}>
      {children}
    </UTMContext.Provider>
  );
}

export function useUTM() {
  const context = useContext(UTMContext);
  if (context === undefined) {
    throw new Error("useUTM must be used within a UTMProvider");
  }
  return context;
}
