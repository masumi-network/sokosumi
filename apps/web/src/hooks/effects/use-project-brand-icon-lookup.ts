"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  resolveProjectSiteIcon,
  updateProject,
} from "@/lib/actions/project/action";

interface UseProjectBrandIconLookupParams {
  projectId: string;
  projectName: string;
  websiteUrl: string;
  logoFailedMessage: string;
  onReadyLogo?: (logoUrl: string | null) => void;
  onBrandChange?: (brand: { logo: string | null }) => void;
}

/**
 * Resolves the project site icon once on first mount of `ProjectBrandSetup`
 * (guarded across viewer-keyed child remounts and StrictMode replays) and
 * persists any found logo on the project.
 */
export function useProjectBrandIconLookup({
  projectId,
  projectName,
  websiteUrl,
  logoFailedMessage,
  onReadyLogo,
  onBrandChange,
}: UseProjectBrandIconLookupParams): {
  logoUrl: string | null;
  isResolvingLogo: boolean;
} {
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [isResolvingLogo, setIsResolvingLogo] = useState(true);
  // Kept here: the icon starts on the first mount and must not start again
  // when brand setup mounts again for the viewer.
  const iconStarted = useRef(false);

  useEffect(() => {
    if (iconStarted.current) return;
    iconStarted.current = true;
    void (async () => {
      try {
        const result = await resolveProjectSiteIcon({
          url: websiteUrl,
          projectId,
        });
        const nextLogo = result.ok ? (result.value.url ?? null) : null;
        setLogoUrl(nextLogo);
        onReadyLogo?.(nextLogo);
        onBrandChange?.({ logo: nextLogo });
        if (nextLogo) {
          const updateResult = await updateProject({
            projectId,
            name: projectName,
            logo: nextLogo,
          });
          if (!updateResult.ok) {
            toast.error(logoFailedMessage);
          }
        }
      } catch (error) {
        console.error("Failed to resolve project logo", error);
        toast.error(logoFailedMessage);
      } finally {
        setIsResolvingLogo(false);
      }
    })();
  }, []);

  return { logoUrl, isResolvingLogo };
}
