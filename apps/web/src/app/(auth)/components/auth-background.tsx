"use client";

import Image from "next/image";
import { useState } from "react";

import { KanjiLogo } from "@/components/masumi-logos";
import { useMountEffect } from "@/hooks/use-mount-effect";

const AUTH_BACKGROUND_IMAGES = [
  "/images/backgrounds/auth-bg-1.png",
  "/images/backgrounds/auth-bg-2.png",
  "/images/backgrounds/auth-bg-3.png",
  "/images/backgrounds/auth-bg-4.png",
  "/images/backgrounds/auth-bg-5.png",
] as const;

export default function AuthBackground() {
  const [backgroundImage, setBackgroundImage] = useState<
    (typeof AUTH_BACKGROUND_IMAGES)[number]
  >(AUTH_BACKGROUND_IMAGES[0]);

  useMountEffect(() => {
    const randomIndex = Math.floor(
      Math.random() * AUTH_BACKGROUND_IMAGES.length,
    );
    setBackgroundImage(AUTH_BACKGROUND_IMAGES[randomIndex]);
  });

  return (
    <div className="hidden h-full w-1/2 lg:block">
      <div className="relative h-full w-full">
        <Image
          alt="auth-bg"
          src={backgroundImage}
          fill
          className="rounded-xl object-cover"
          sizes="50vw"
        />
        <div className="pointer-events-none absolute right-4 bottom-4 text-white">
          <KanjiLogo className="fill-white" />
        </div>
      </div>
    </div>
  );
}
