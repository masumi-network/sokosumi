import Image from "next/image";

import { KanjiLogo } from "@/components/masumi-logos";

export const AUTH_BACKGROUND_IMAGES = [
  "/images/backgrounds/auth-bg-1.png",
  "/images/backgrounds/auth-bg-2.png",
  "/images/backgrounds/auth-bg-3.png",
  "/images/backgrounds/auth-bg-4.png",
  "/images/backgrounds/auth-bg-5.png",
] as const;

export type AuthBackgroundImage = (typeof AUTH_BACKGROUND_IMAGES)[number];

/**
 * Pick the auth hero image before first paint.
 * Inject `random` in tests; production uses Math.random on the dynamic auth shell.
 */
export function pickAuthBackgroundImage(
  random: () => number = Math.random,
): AuthBackgroundImage {
  const index = Math.floor(random() * AUTH_BACKGROUND_IMAGES.length);
  return AUTH_BACKGROUND_IMAGES[index] ?? AUTH_BACKGROUND_IMAGES[0];
}

/**
 * Half-viewport auth marketing image (lg+). Server Component so the LCP src is
 * final on first HTML — no client mount swap — and `priority` preloads it.
 */
export default function AuthBackground() {
  const backgroundImage = pickAuthBackgroundImage();

  return (
    <div className="hidden h-full w-1/2 lg:block">
      <div className="relative h-full w-full">
        <Image
          alt=""
          src={backgroundImage}
          fill
          priority
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
