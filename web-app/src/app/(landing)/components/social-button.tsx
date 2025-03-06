"use client";

import Image from "next/image";

import { Button } from "@/components/ui/button";

interface SocialButtonProps {
  iconPath: string;
  altText?: string;
  children: React.ReactNode;
  onClick?: () => void;
}

export default function SocialButton({
  iconPath,
  children,
  onClick,
  altText,
}: SocialButtonProps) {
  const alt =
    altText ??
    (typeof children === "string" ? `${children} icon` : "social icon");

  return (
    <Button variant="outline" onClick={onClick}>
      <Image
        src={iconPath}
        alt={alt}
        width={20}
        height={20}
        className="h-4 w-4"
      />
      <span>{children}</span>
    </Button>
  );
}

export function XButton() {
  return (
    <SocialButton
      iconPath="/socials/x.svg"
      onClick={() =>
        window.open(
          "https://x.com/MasumiNetwork",
          "_blank",
          "noopener,noreferrer",
        )
      }
    >
      Platform X
    </SocialButton>
  );
}

export function DiscordButton() {
  return (
    <SocialButton
      iconPath="/socials/discord.svg"
      onClick={() =>
        window.open(
          "https://discord.gg/aj4QfnTS92",
          "_blank",
          "noopener,noreferrer",
        )
      }
    >
      Discord
    </SocialButton>
  );
}

export function GitHubButton({
  children,
  url,
}: {
  children: React.ReactNode;
  url: string;
}) {
  return (
    <SocialButton
      iconPath="/socials/github.svg"
      onClick={() => window.open(url, "_blank", "noopener,noreferrer")}
    >
      {children}
    </SocialButton>
  );
}

export function MasumiButton() {
  return (
    <Button
      onClick={() =>
        window.open("https://masumi.network", "_blank", "noopener,noreferrer")
      }
    >
      Masumi Network
    </Button>
  );
}
