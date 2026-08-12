"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";

export interface OnboardingCoworker {
  /** Null when there is no usable image; the face falls back to an initial. */
  avatarUrl: null | string;
  name: string;
}

interface WelcomeStepProps {
  coworkers: OnboardingCoworker[];
  userName: null | string;
}

export function WelcomeStep({ coworkers, userName }: WelcomeStepProps) {
  const t = useTranslations("Onboarding.Flow.Welcome");

  return (
    <div className="w-full text-center">
      {/* Same treatment as the chat welcome and the agents page: light and
          large, so the greeting reads as a welcome rather than a form label. */}
      <h1 className="text-foreground text-2xl font-light text-balance sm:text-3xl">
        {userName ? t("titleNamed", { name: userName }) : t("title")}
      </h1>
      <p className="text-muted-foreground mx-auto mt-4 max-w-[52ch] text-base leading-[1.65] text-balance">
        {t("subtitle")}
      </p>

      {coworkers.length > 0 ? (
        <>
          {/* Faces at a size worth looking at, each with a ring: several
              coworker portraits are dark on dark and vanish into the page
              without an edge to hold them. */}
          <div className="mt-9 flex items-center justify-center gap-4">
            {coworkers.map((coworker) => (
              <div
                key={coworker.name}
                className="ring-border bg-muted relative size-16 shrink-0 overflow-hidden rounded-full ring-1"
              >
                {coworker.avatarUrl ? (
                  <Image
                    alt={t("avatarAlt", { name: coworker.name })}
                    className="object-cover object-top"
                    fill
                    sizes="64px"
                    src={coworker.avatarUrl}
                  />
                ) : (
                  <span className="text-muted-foreground flex size-full items-center justify-center text-sm font-medium">
                    {coworker.name.charAt(0).toUpperCase()}
                  </span>
                )}
              </div>
            ))}
          </div>
          <p className="text-muted-foreground/80 mt-4 text-[0.8125rem]">
            {t("coworkersSummary", {
              names: coworkers.map((coworker) => coworker.name).join(", "),
            })}
          </p>
        </>
      ) : null}
    </div>
  );
}
