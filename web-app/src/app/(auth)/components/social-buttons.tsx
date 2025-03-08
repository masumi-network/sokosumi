"use client";

import { ComponentProps } from "react";
import {
  AppleLoginButton,
  GoogleLoginButton,
  LinkedInLoginButton,
  MicrosoftLoginButton,
} from "react-social-login-buttons";

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
  const handleClick = (key: SocialKey) => {
    console.log({ variant, key });
  };

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:gap-6">
      {socialButtons.map((socialButton) => (
        <socialButton.button
          onClick={() => handleClick(socialButton.key)}
          key={socialButton.key}
          className="flex items-center justify-center !rounded-lg !px-3 !py-2 !text-base"
          align="center"
          text={`Continue with ${socialButton.key}`}
        />
      ))}
    </div>
  );
}
