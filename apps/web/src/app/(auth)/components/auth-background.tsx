import Image from "next/image";

import { KanjiLogo } from "@/components/masumi-logos";

import AuthAside from "./auth-aside";

export const AUTH_BACKGROUND_IMAGES = [
  "/images/backgrounds/auth-bg-1.png",
  "/images/backgrounds/auth-bg-2.png",
  "/images/backgrounds/auth-bg-3.png",
  "/images/backgrounds/auth-bg-4.png",
  "/images/backgrounds/auth-bg-5.png",
] as const;

export type AuthBackgroundImage = (typeof AUTH_BACKGROUND_IMAGES)[number];

/**
 * Match Tailwind `lg` (1024px). Below that the hero is `hidden` — size `0px` so
 * `preload` + srcset selects a near-zero candidate instead of a half-viewport
 * PNG that never paints on mobile.
 */
export const AUTH_BACKGROUND_SIZES = "(max-width: 1023px) 0px, 50vw" as const;

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
 * final on first HTML — no client mount swap — and `preload` starts the fetch.
 */
export default function AuthBackground() {
  const backgroundImage = pickAuthBackgroundImage();

  return (
    <aside
      className="relative hidden h-full w-1/2 lg:block"
      aria-labelledby="auth-aside-title"
    >
      <div className="relative h-full w-full">
        <Image
          alt=""
          src={backgroundImage}
          fill
          preload
          className="rounded-xl object-cover"
          sizes={AUTH_BACKGROUND_SIZES}
        />
        <AuthAside />
        <div className="pointer-events-none absolute top-10 right-10 z-10 xl:top-12 xl:right-12">
          <KanjiLogo className="h-9 fill-white/90" />
        </div>
      </div>
    </aside>
  );
}
