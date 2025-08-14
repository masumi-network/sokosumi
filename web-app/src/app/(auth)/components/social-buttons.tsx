"use client";

import { useTranslations } from "next-intl";
import { ComponentProps } from "react";
import {
  GoogleLoginButton,
  MicrosoftLoginButton,
} from "react-social-login-buttons";
import { toast } from "sonner";

import { authClient } from "@/lib/auth/auth.client";

type SocialKey = "google" | "microsoft";
const socialButtons: Array<{
  key: SocialKey;
  Button: React.FC<ComponentProps<typeof GoogleLoginButton>>;
}> = [
  {
    key: "google",
    Button: GoogleLoginButton,
  },
  {
    key: "microsoft",
    Button: MicrosoftLoginButton,
  },
];

export default function SocialButtons() {
  const t = useTranslations("Auth.SocialButtons");

  const handleClick = async (key: SocialKey) => {
    const result = await authClient.signIn.social({
      provider: key,
    });
    if (result.error) {
      const errorMessage = result.error.message ?? t("error");
      toast.error(errorMessage);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-2">
      {socialButtons.map((socialButton) => (
        <socialButton.Button
          onClick={() => handleClick(socialButton.key)}
          key={socialButton.key}
          className="flex items-center justify-center !rounded-lg !px-3 !py-2 !text-sm"
          align="center"
          text={t("continueWith", { provider: socialButton.key })}
        />
      ))}
    </div>
  );
}
