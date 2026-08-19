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
 * Diagonal composition: claim + proof top-left, endorsement pinned bottom-right
 * at the same inset as the Kanji mark (`p-10` / `xl:p-12`). Scrims and quote sit
 * on a static layer so overflow scroll of the copy does not drag them off the
 * photo.
 */
export default async function AuthAside() {
  const t = await getTranslations("Auth.Aside");

  return (
    <div
      data-testid="auth-aside"
      className="absolute inset-0 overflow-hidden rounded-xl"
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

      <div
        data-testid="auth-aside-scroll"
        className="absolute inset-0 z-10 overflow-y-auto p-10 xl:p-12"
      >
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

          <section
            data-testid="auth-aside-logos"
            className="group mt-10 rounded-sm"
            aria-labelledby="auth-customer-logos-label"
          >
            <div className="flex items-baseline justify-between gap-3">
              <p
                id="auth-customer-logos-label"
                className="font-medium text-white text-xs uppercase tracking-[0.16em]"
              >
                {t("logosLabel")}
              </p>
              <button
                type="button"
                className="sr-only rounded-sm text-white text-xs uppercase tracking-[0.16em] focus:not-sr-only focus:px-1.5 focus:py-0.5 focus:ring-2 focus:ring-white/80"
              >
                {t("pauseLogos")}
              </button>
            </div>
            <div className="mt-4 overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_1.25rem,black_calc(100%-1.25rem),transparent)] motion-reduce:[mask-image:none]">
              <div className="flex w-max animate-auth-logo-marquee group-focus-within:[animation-play-state:paused] group-hover:[animation-play-state:paused] motion-reduce:w-full motion-reduce:animate-none">
                {[0, 1].map((copy) => (
                  <ul
                    key={copy}
                    className="flex shrink-0 items-center gap-x-8 pr-8 motion-reduce:w-full motion-reduce:flex-wrap motion-reduce:gap-y-4 motion-reduce:pr-0 motion-reduce:[&:nth-child(2)]:hidden"
                    aria-hidden={copy === 1 || undefined}
                  >
                    {AUTH_MARQUEE_LOGOS.map((logo) => (
                      <li key={`${logo.src}-${copy}`} className="flex shrink-0">
                        <Image
                          src={logo.src}
                          alt={copy === 0 ? logo.alt : ""}
                          width={logo.width}
                          height={logo.height}
                          className="max-w-none shrink-0 opacity-95"
                        />
                      </li>
                    ))}
                  </ul>
                ))}
              </div>
            </div>
          </section>
        </div>
      </div>

      <figure
        data-testid="auth-aside-quote"
        className="absolute right-10 bottom-10 z-10 max-w-md text-right xl:right-12 xl:bottom-12"
      >
        <blockquote className="text-balance text-lg text-white leading-snug">
          {t("quote")}
        </blockquote>
        <figcaption className="mt-5 flex items-center justify-end gap-3 text-sm">
          <Image
            src="/images/auth/florian-haller.webp"
            alt=""
            width={48}
            height={48}
            className="size-12 shrink-0 rounded-full object-cover object-center ring-1 ring-white/20"
          />
          <div className="text-left">
            <div className="whitespace-nowrap text-white">
              {t("quoteAuthor")}
            </div>
            <div className="whitespace-nowrap text-white">{t("quoteRole")}</div>
          </div>
          <div className="border-white/20 border-l pl-4">
            <Image
              src={AUTH_SERVICEPLAN_LOGO.src}
              alt=""
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
