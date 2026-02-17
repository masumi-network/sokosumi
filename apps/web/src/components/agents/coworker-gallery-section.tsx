"use client";

import type { Coworker } from "@sokosumi/database";
import Image from "next/image";
import { useTranslations } from "next-intl";

import { CoworkerGalleryCard } from "./coworker-gallery-card";

interface CoworkerGallerySectionProps {
  coworkers: Coworker[];
}

function CoworkerGallerySection({ coworkers }: CoworkerGallerySectionProps) {
  const t = useTranslations("App.Agents.CoworkerGallerySection");

  if (!coworkers.length) {
    return null;
  }

  return (
    <section className="dark:bg-card-background overflow-hidden rounded-xl bg-neutral-950 dark:border">
      <div className="grid gap-6 p-6 md:grid-cols-[320px_1fr] md:gap-0 md:p-0">
        {/* Content — left column */}
        <div className="flex flex-col justify-between md:border-r md:border-white/10 md:p-8">
          <div>
            <h2 className="text-xl font-medium text-balance text-white md:text-2xl">
              {t("title")}
            </h2>

            <div className="mt-4">
              <p className="text-xs font-medium tracking-wider text-white/40 uppercase">
                {t("whatTheyDo.title")}
              </p>
              <p className="mt-1.5 text-sm leading-relaxed text-pretty text-white/50">
                {t("whatTheyDo.description")}
              </p>
            </div>

            <div className="mt-4 border-t border-white/10 pt-4">
              <p className="text-xs font-medium tracking-wider text-white/40 uppercase">
                {t("marketingExpertise.title")}
              </p>
              <p className="mt-1.5 text-sm leading-relaxed text-pretty text-white/50">
                {t("marketingExpertise.description")}
              </p>
            </div>
          </div>

          <Image
            src="/images/logos/serviceplan-logo-white.png"
            alt={t("serviceplanLogoAlt")}
            width={120}
            height={19}
            className="mt-6"
          />
        </div>

        {/* Cards — right */}
        <div className="flex snap-x snap-mandatory items-center gap-5 overflow-x-auto px-6 pb-6 md:snap-none md:py-8 md:pr-8 md:pb-8 md:pl-8">
          {coworkers.map((coworker) => (
            <div key={coworker.id} className="shrink-0 snap-start">
              <CoworkerGalleryCard
                slug={coworker.slug}
                name={coworker.name}
                image={coworker.image}
                description={coworker.description}
                className="w-52"
              />
            </div>
          ))}

          {/* Coming soon */}
          <div className="flex shrink-0 items-center px-4">
            <p className="text-sm whitespace-nowrap text-white/30">
              {t("moreComingSoon")}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

export { CoworkerGallerySection };
