import type { ReactNode } from "react";

import { GoogleIcon, MicrosoftIcon } from "@/components/social-icons";
import { AccountProvider } from "@/lib/auth/types";

/** The providers a viewer can link an account with, besides a password. */
export type SocialProvider = AccountProvider.GOOGLE | AccountProvider.MICROSOFT;

export const SOCIAL_PROVIDERS: SocialProvider[] = [
  AccountProvider.GOOGLE,
  AccountProvider.MICROSOFT,
];

/** Brand names, shown as written in every locale. */
export const SOCIAL_PROVIDER_NAMES: Record<SocialProvider, string> = {
  [AccountProvider.GOOGLE]: "Google",
  [AccountProvider.MICROSOFT]: "Microsoft",
};

export const SOCIAL_PROVIDER_ICONS: Record<SocialProvider, ReactNode> = {
  [AccountProvider.GOOGLE]: <GoogleIcon />,
  [AccountProvider.MICROSOFT]: <MicrosoftIcon />,
};
