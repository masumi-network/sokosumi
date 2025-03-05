"use client";

import Image from "next/image";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface SocialButtonProps {
  iconPath: string;
  title: string;
  onClick?: () => void;
  className?: string;
}

export default function SocialButton({
  iconPath,
  title,
  onClick,
  className,
}: SocialButtonProps) {
  return (
    <Button
      className={cn(
        "flex items-center gap-2 bg-[#4F4F58] hover:bg-[#4F4F58]/90",
        className,
      )}
      onClick={onClick}
    >
      <Image
        src={iconPath}
        alt={`${title} icon`}
        width={20}
        height={20}
        className="h-5 w-5"
      />
      <span>{title}</span>
    </Button>
  );
}

export function XButton() {
  return (
    <SocialButton
      iconPath="/socials/x.svg"
      title="Platform X"
      onClick={() =>
        window.open("https://x.com/sokosumi", "_blank", "noopener,noreferrer")
      }
    />
  );
}

export function DiscordButton() {
  return (
    <SocialButton
      iconPath="/socials/discord.svg"
      title="Discord"
      onClick={() =>
        window.open(
          "https://discord.gg/sokosumi",
          "_blank",
          "noopener,noreferrer",
        )
      }
    />
  );
}
