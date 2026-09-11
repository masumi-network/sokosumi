import type { Account } from "@sokosumi/utils";
import type { ReactNode } from "react";

import { GoogleIcon, MicrosoftIcon } from "@/components/social-icons";
import { AccountProvider } from "@/lib/auth/types";

/** The providers a viewer can link an account with, besides a password. */
export type SocialProvider = AccountProvider.GOOGLE | AccountProvider.MICROSOFT;

export const SOCIAL_PROVIDERS: SocialProvider[] = [
  AccountProvider.GOOGLE,
  AccountProvider.MICROSOFT,
];

export const SOCIAL_PROVIDER_ICONS: Record<SocialProvider, ReactNode> = {
  [AccountProvider.GOOGLE]: <GoogleIcon />,
  [AccountProvider.MICROSOFT]: <MicrosoftIcon />,
};

export function isSocialProvider(
  providerId: string,
): providerId is SocialProvider {
  return SOCIAL_PROVIDERS.some((provider) => provider === providerId);
}

/** True when a viewer owns at least one method the re-auth dialog can offer. */
export function canReauthenticateWith(accounts: Account[]): boolean {
  return accounts.some(
    (account) =>
      account.providerId === AccountProvider.CREDENTIAL ||
      isSocialProvider(account.providerId),
  );
}
