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
  name: string;
  Button: React.FC<ComponentProps<typeof GoogleLoginButton>>;
}> = [
  {
    key: "google",
    name: "Google",
    Button: GoogleLoginButton,
  },
  {
    key: "microsoft",
    name: "Microsoft",
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
    <div className="flex flex-col gap-3">
      {socialButtons.map((socialButton) => (
        <socialButton.Button
          onClick={() => handleClick(socialButton.key)}
          key={socialButton.key}
          className="bg-senary! hover:bg-quinary! text-foreground! m-0! flex w-full! rounded-md! px-4! py-2! text-sm! shadow-none! transition-colors! duration-300! [&>div]:justify-center! [&>div]:gap-2! [&>div_div]:w-auto!"
          align="center"
          text={t("continueWith", { provider: socialButton.name })}
        />
      ))}
    </div>
  );
}
