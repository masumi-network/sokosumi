"use client";

import { useTranslations } from "next-intl";
import { ComponentProps } from "react";
import {
  AppleLoginButton,
  GoogleLoginButton,
  LinkedInLoginButton,
  MicrosoftLoginButton,
} from "react-social-login-buttons";

import Divider from "./divider";

type SocialKey = "Google" | "Microsoft" | "Apple" | "LinkedIn";
const socialButtons: Array<{
  key: SocialKey;
  button: React.FC<ComponentProps<typeof GoogleLoginButton>>;
}> = [
  {
    key: "Google",
    button: GoogleLoginButton,
  },
  {
    key: "Microsoft",
    button: MicrosoftLoginButton,
  },
  {
    key: "Apple",
    button: AppleLoginButton,
  },
  {
    key: "LinkedIn",
    button: LinkedInLoginButton,
  },
];

interface SocialButtonsProps {
  variant: "signin" | "signup";
}

export default function SocialButtons({ variant }: SocialButtonsProps) {
  const t = useTranslations("Auth.SocialButtons");

  const handleClick = (key: SocialKey) => {
    console.log({ variant, key });
  };

  return (
    <>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:gap-6">
        {socialButtons.map((socialButton) => (
          <socialButton.button
            onClick={() => handleClick(socialButton.key)}
            key={socialButton.key}
            className="flex items-center justify-center !rounded-lg !px-3 !py-2 !text-sm"
            align="center"
            text={t("continueWith", { provider: socialButton.key })}
          />
        ))}
      </div>
      <Divider label={t("divider")} />
    </>
  );
}
