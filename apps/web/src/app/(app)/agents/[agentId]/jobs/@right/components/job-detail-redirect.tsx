"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import DefaultLoading from "@/components/default-loading";
import { buildJobHref } from "@/lib/utils/job-href";

interface JobDetailRedirectProps {
  jobId: string;
}

export default function JobDetailRedirect({ jobId }: JobDetailRedirectProps) {
  const router = useRouter();
  const hasRedirectedRef = useRef(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(min-width: 1024px)");

    function tryRedirect(matches: boolean) {
      if (!matches || hasRedirectedRef.current) {
        return;
      }

      hasRedirectedRef.current = true;
      router.push(buildJobHref(jobId));
    }

    function handleViewportChange(event: MediaQueryListEvent) {
      tryRedirect(event.matches);
    }

    tryRedirect(mediaQuery.matches);

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleViewportChange);

      return () => {
        mediaQuery.removeEventListener("change", handleViewportChange);
      };
    }

    mediaQuery.addListener(handleViewportChange);

    return () => {
      mediaQuery.removeListener(handleViewportChange);
    };
  }, [jobId, router]);

  return <DefaultLoading className="h-full w-full flex-1 p-8" />;
}
