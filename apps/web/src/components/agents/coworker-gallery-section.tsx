"use client";

import type { Coworker } from "@sokosumi/database";
import Image from "next/image";

import { CoworkerGalleryCard } from "./coworker-gallery-card";

interface CoworkerGallerySectionProps {
  coworkers: Coworker[];
}

function CoworkerGallerySection({ coworkers }: CoworkerGallerySectionProps) {
  if (!coworkers.length) {
    return null;
  }

  return (
    <section className="overflow-hidden rounded-xl bg-neutral-950 dark:border dark:bg-card-background">
      <div className="grid gap-6 p-6 md:grid-cols-[320px_1fr] md:gap-0 md:p-0">
        {/* Content — left column */}
        <div className="flex flex-col justify-between md:border-r md:border-white/10 md:p-8">
          <div>
            <h2 className="text-xl font-medium text-white text-balance md:text-2xl">
              Agentic Coworkers
            </h2>

            <div className="mt-4">
              <p className="text-xs font-medium uppercase tracking-wider text-white/40">
                What They Do
              </p>
              <p className="mt-1.5 text-sm leading-relaxed text-white/50 text-pretty">
                AI coworkers you can assign real work to. They work on their
                own and get it done.
              </p>
            </div>

            <div className="mt-4 border-t border-white/10 pt-4">
              <p className="text-xs font-medium uppercase tracking-wider text-white/40">
                Marketing Expertise
              </p>
              <p className="mt-1.5 text-sm leading-relaxed text-white/50 text-pretty">
                Trained on real campaign work &mdash; strategy, content, media
                planning, and brand communications.
              </p>
            </div>
          </div>

          <Image
            src="/images/logos/serviceplan-logo-white.png"
            alt="Serviceplan Group"
            width={120}
            height={19}
            className="mt-6"
          />
        </div>

        {/* Cards — right */}
        <div className="flex items-center gap-5 overflow-x-auto px-6 pb-6 snap-x snap-mandatory md:py-8 md:pr-8 md:pb-8 md:pl-8 md:snap-none">
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
            <p className="whitespace-nowrap text-sm text-white/30">
              + More coming soon
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

export { CoworkerGallerySection };
