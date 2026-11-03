"use client";

import type { ProjectSocialProvider } from "@sokosumi/core-client";
import { SOCIAL_PUBLIC_PROVIDERS } from "@sokosumi/utils";
import { createContext, type ReactNode, useContext } from "react";

/** Core supplies the current workspace's list through the authenticated app frame. */
export const SocialProviderAvailabilityContext = createContext<
  readonly ProjectSocialProvider[]
>(SOCIAL_PUBLIC_PROVIDERS);

export function SocialProviderAvailabilityProvider({
  enabledProviders,
  children,
}: {
  enabledProviders: readonly ProjectSocialProvider[];
  children: ReactNode;
}) {
  return (
    <SocialProviderAvailabilityContext value={enabledProviders}>
      {children}
    </SocialProviderAvailabilityContext>
  );
}

export function useSocialProviderAvailability() {
  const enabledProviders = useContext(SocialProviderAvailabilityContext);
  return {
    enabledProviders,
    isProviderEnabled: (provider: string) =>
      (enabledProviders as readonly string[]).includes(provider),
  };
}
