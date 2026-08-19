import Image from "next/image";
import { getTranslations } from "next-intl/server";

import {
  AUTH_MARQUEE_LOGOS,
  AUTH_SERVICEPLAN_LOGO,
} from "./auth-customer-logos";

const BULLET_KEYS = ["bullet1", "bullet2", "bullet3"] as const;

/**
 * Marketing proof on the auth photo. Server-only so copy is in the first HTML.
 *
 * Diagonal composition: claim + proof top-left, endorsement bottom-right, photo
 * breathes in between. Scrims sit on the two edges only so the image is not
 * washed out. Bottom-right keeps the quote clear of the centred cookie banner.
 */
export default async function AuthAside() {
  const t = await getTranslations("Auth.Aside");

  return (
    <div
      data-testid="auth-aside"
      className="absolute inset-0 flex flex-col justify-between overflow-y-auto rounded-xl p-10 xl:p-12"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 w-4/5 rounded-l-xl bg-gradient-to-r from-black/45 via-black/25 to-transparent"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-3/5 rounded-t-xl bg-gradient-to-b from-black/60 via-black/30 to-transparent"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 rounded-b-xl bg-gradient-to-t from-black/60 to-transparent"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-white/10 ring-inset"
      />

      <div className="relative z-10 max-w-md">
        <h2
          id="auth-aside-title"
          className="font-medium text-4xl text-white leading-[1.05] tracking-tight xl:text-5xl"
        >
          <span className="block">{t("titleLine1")}</span>
          <span className="block">{t("titleLine2")}</span>
        </h2>

        <ul className="mt-10 border-white/15 border-t">
          {BULLET_KEYS.map((key) => (
            <li
              key={key}
              className="border-white/15 border-b py-3.5 text-base text-white/85 leading-snug"
            >
              {t(key)}
            </li>
          ))}
        </ul>

        <div data-testid="auth-aside-logos" className="mt-10">
          <p className="font-medium text-white/45 text-xs uppercase tracking-[0.16em]">
            {t("logosLabel")}
          </p>
          <div className="mt-4 overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_1.25rem,black_calc(100%-1.25rem),transparent)]">
            <ul className="flex w-max animate-auth-logo-marquee items-center gap-x-8 pr-8 motion-reduce:animate-none">
              {[...AUTH_MARQUEE_LOGOS, ...AUTH_MARQUEE_LOGOS].map(
                (logo, index) => {
                  const isClone = index >= AUTH_MARQUEE_LOGOS.length;
                  return (
                    <li
                      key={`${logo.src}-${index}`}
                      className={
                        isClone
                          ? "flex shrink-0 items-center motion-reduce:hidden"
                          : "flex shrink-0 items-center"
                      }
                    >
                      <Image
                        src={logo.src}
                        alt={isClone ? "" : logo.alt}
                        width={logo.width}
                        height={logo.height}
                        className="opacity-95"
                        aria-hidden={isClone}
                      />
                    </li>
                  );
                },
              )}
            </ul>
          </div>
        </div>
      </div>

      <figure className="relative z-10 mt-12 ml-auto max-w-md text-right">
        <blockquote className="text-balance text-lg text-white leading-snug">
          {t("quote")}
        </blockquote>
        <figcaption className="mt-5 flex items-center justify-end gap-3 text-sm">
          <Image
            src="/images/auth/florian-haller.webp"
            alt={t("quoteAuthor")}
            width={40}
            height={40}
            className="size-10 shrink-0 rounded-full object-cover ring-1 ring-white/20"
          />
          <div className="text-left">
            <div className="whitespace-nowrap text-white">
              {t("quoteAuthor")}
            </div>
            <div className="whitespace-nowrap text-white/55">
              {t("quoteRole")}
            </div>
          </div>
          <div className="border-white/20 border-l pl-4">
            <Image
              src={AUTH_SERVICEPLAN_LOGO.src}
              alt={AUTH_SERVICEPLAN_LOGO.alt}
              width={AUTH_SERVICEPLAN_LOGO.width}
              height={AUTH_SERVICEPLAN_LOGO.height}
              className="opacity-90"
            />
          </div>
        </figcaption>
      </figure>
    </div>
  );
}
