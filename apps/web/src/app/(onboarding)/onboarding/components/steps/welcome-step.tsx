"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";

export interface OnboardingCoworker {
  avatarUrl: string;
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
      <h1 className="text-[1.625rem] leading-[1.15] font-semibold tracking-[-0.02em] text-balance sm:text-[1.875rem]">
        {userName ? t("titleNamed", { name: userName }) : t("title")}
      </h1>
      <p className="text-muted-foreground mx-auto mt-3 max-w-[46ch] text-[0.9375rem] leading-[1.6] text-balance">
        {t("subtitle")}
      </p>

      {coworkers.length > 0 ? (
        <div className="mt-8 flex items-center justify-center gap-3">
          <div className="flex -space-x-2">
            {coworkers.map((coworker) => (
              <div
                key={coworker.name}
                className="ring-background bg-muted relative size-8 overflow-hidden rounded-full ring-2"
              >
                <Image
                  src={coworker.avatarUrl}
                  alt={t("avatarAlt", { name: coworker.name })}
                  fill
                  className="object-cover"
                />
              </div>
            ))}
          </div>
          <span className="text-muted-foreground text-sm">
            {t("coworkersSummary", {
              names: coworkers.map((coworker) => coworker.name).join(", "),
            })}
          </span>
        </div>
      ) : null}
    </div>
  );
}
