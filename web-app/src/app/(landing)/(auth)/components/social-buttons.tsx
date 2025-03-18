"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ComponentProps } from "react";
import {
  AppleLoginButton,
  GoogleLoginButton,
  LinkedInLoginButton,
  MicrosoftLoginButton,
} from "react-social-login-buttons";
import { toast } from "sonner";

import { signInSocial } from "../actions";
import Divider from "./divider";

type SocialKey = "google" | "microsoft" | "apple" | "linkedin";
const socialButtons: Array<{
  key: SocialKey;
  button: React.FC<ComponentProps<typeof GoogleLoginButton>>;
}> = [
  {
    key: "google",
    button: GoogleLoginButton,
  },
  {
    key: "microsoft",
    button: MicrosoftLoginButton,
  },
  {
    key: "apple",
    button: AppleLoginButton,
  },
  {
    key: "linkedin",
    button: LinkedInLoginButton,
  },
];

export default function SocialButtons() {
  const t = useTranslations("Auth.SocialButtons");
  const router = useRouter();

  const handleClick = async (key: SocialKey) => {
    const result = await signInSocial(key);
    if (result.success) {
      toast.success(t("success"));
      router.push("/dashboard");
    } else {
      toast.error(t("error"));
    }
  };

  return (
    <>
      <div className="grid grid-cols-1 gap-4 lg:gap-6">
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
