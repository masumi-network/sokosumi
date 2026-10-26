"use client";

import type { ProjectSocialProvider } from "@sokosumi/core-client";
import { SOCIAL_PUBLIC_PROVIDERS } from "@sokosumi/utils";
import { createContext, type ReactNode, useContext } from "react";

interface SocialProviderAvailability {
  enabledProviders: readonly ProjectSocialProvider[];
  /** LinkedIn accounts may add the company pages they administer. */
  linkedInCompanyPagesEnabled: boolean;
}

/** Core supplies the current workspace's list through the authenticated app frame. */
export const SocialProviderAvailabilityContext =
  createContext<SocialProviderAvailability>({
    enabledProviders: SOCIAL_PUBLIC_PROVIDERS,
    linkedInCompanyPagesEnabled: false,
  });

export function SocialProviderAvailabilityProvider({
  enabledProviders,
  linkedInCompanyPagesEnabled = false,
  children,
}: {
  enabledProviders: readonly ProjectSocialProvider[];
  linkedInCompanyPagesEnabled?: boolean;
  children: ReactNode;
}) {
  return (
    <SocialProviderAvailabilityContext
      value={{ enabledProviders, linkedInCompanyPagesEnabled }}
    >
      {children}
    </SocialProviderAvailabilityContext>
  );
}

export function useSocialProviderAvailability() {
  const { enabledProviders, linkedInCompanyPagesEnabled } = useContext(
    SocialProviderAvailabilityContext,
  );
  return {
    enabledProviders,
    linkedInCompanyPagesEnabled,
    isProviderEnabled: (provider: string) =>
      (enabledProviders as readonly string[]).includes(provider),
  };
}
