"use client";

import { Sparkles } from "lucide-react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { canUseNextImageSrc } from "@/config/next-image";
import type { Coworker } from "@/lib/clients/generated/core";
import { getCoworkerMetadataChannels } from "@/lib/utils/coworker-channels";

import { CoworkerGalleryCard } from "./coworker-gallery-card";

interface CoworkerGallerySectionProps {
  coworkers: Coworker[];
}

function CoworkerGallerySection({ coworkers }: CoworkerGallerySectionProps) {
  const t = useTranslations("App.Agents.CoworkerGallerySection");
  const coworkerGroups = useMemo(
    () => groupCoworkersByCompany(coworkers, t("others")),
    [coworkers, t],
  );
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const activeGroupId =
    selectedGroupId &&
    coworkerGroups.some((group) => group.id === selectedGroupId)
      ? selectedGroupId
      : (coworkerGroups[0]?.id ?? "");

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
        </div>

        {/* Cards — right */}
        <Tabs
          value={activeGroupId}
          onValueChange={setSelectedGroupId}
          className="flex min-h-0 min-w-0 flex-col gap-5 md:py-8 md:pr-8 md:pb-8 md:pl-8"
        >
          <div className="overflow-x-auto">
            <TabsList className="flex h-auto w-max min-w-full items-center justify-start gap-1 rounded-lg bg-neutral-800 p-1 md:min-w-auto dark:bg-neutral-800">
              {coworkerGroups.map((group) => (
                <TabsTrigger
                  key={group.id}
                  value={group.id}
                  className="hover:text-foreground data-[state=active]:bg-background dark:data-[state=active]:bg-background data-[state=active]:text-foreground h-auto shrink-0 rounded-md border-none px-3 py-1.5 text-sm font-medium text-white transition-colors data-[state=active]:shadow-sm"
                >
                  <span className="flex items-center gap-2">
                    <span className="text-foreground inline-flex size-8 items-center justify-center overflow-hidden rounded-full text-xs font-semibold uppercase">
                      {group.id === "others" ? (
                        <Sparkles className="size-4" aria-hidden />
                      ) : group.logo && canUseNextImageSrc(group.logo) ? (
                        <Image
                          src={group.logo}
                          alt={group.name}
                          width={40}
                          height={40}
                          unoptimized={true}
                          className="size-8 object-contain"
                        />
                      ) : (
                        getGroupInitial(group.name)
                      )}
                    </span>
                    <span className="whitespace-nowrap">{group.name}</span>
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          {coworkerGroups.map((group) => (
            <TabsContent
              key={group.id}
              value={group.id}
              className="mt-0 w-full min-w-0"
            >
              <div className="flex w-full snap-x snap-mandatory items-center gap-5 overflow-x-auto px-6 pb-6 md:snap-none md:px-0 md:pb-0">
                {group.coworkers.map((coworker) => (
                  <div key={coworker.id} className="shrink-0 snap-start">
                    <CoworkerGalleryCard
                      slug={coworker.slug}
                      name={coworker.name}
                      image={coworker.image}
                      caption={coworker.caption}
                      description={coworker.description}
                      channels={getCoworkerMetadataChannels(coworker)}
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
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </section>
  );
}

interface CoworkerGroup {
  id: string;
  name: string;
  logo: string | null;
  coworkers: Coworker[];
}

function getGroupInitial(name: string): string {
  const trimmedName = name.trim();
  if (!trimmedName) return "?";
  return trimmedName.charAt(0);
}

function groupCoworkersByCompany(
  coworkers: Coworker[],
  othersLabel: string,
): CoworkerGroup[] {
  const grouped = new Map<string, CoworkerGroup>();

  coworkers.forEach((coworker) => {
    const companyName = coworker.company?.trim();
    const companyLogo = coworker.companyLogo;
    const companySlug = companyName ? toCompanySlug(companyName) : null;

    const groupId = companySlug ? `company:${companySlug}` : "others";

    if (!grouped.has(groupId)) {
      grouped.set(groupId, {
        id: groupId,
        name: groupId === "others" ? othersLabel : (companyName ?? othersLabel),
        logo: companyLogo ?? null,
        coworkers: [],
      });
    }

    const group = grouped.get(groupId);
    if (!group) return;
    if (!group.logo && companyLogo) {
      group.logo = companyLogo;
    }
    group.coworkers.push(coworker);
  });

  const groups = Array.from(grouped.values());
  const servicePlanIndex = groups.findIndex(
    (group) => group.id === "company:serviceplan",
  );

  if (servicePlanIndex > 0) {
    const [servicePlanGroup] = groups.splice(servicePlanIndex, 1);
    if (servicePlanGroup) {
      groups.unshift(servicePlanGroup);
    }
  }

  return groups;
}

function toCompanySlug(companyName: string): string {
  return companyName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export { CoworkerGallerySection };
