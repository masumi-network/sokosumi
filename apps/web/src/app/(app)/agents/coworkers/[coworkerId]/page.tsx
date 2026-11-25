import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { loadAgentsCoworkers } from "@/app/agents/agents-page-data";
import { CoworkerAvatar } from "@/components/agents/coworker-avatar";
import {
  AboutList,
  AgentProfile,
  AgentProfileSkeleton,
} from "@/components/agents/directory/agent-profile";

import { CoworkerActions, CoworkerOffers } from "./coworker-profile.client";

async function findCoworker(coworkerId: string) {
  const coworkers = await loadAgentsCoworkers();
  return coworkers.find((coworker) => coworker.id === coworkerId) ?? null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ coworkerId: string }>;
}): Promise<Metadata> {
  const coworker = await findCoworker((await params).coworkerId);
  return {
    title: coworker?.name,
    description: coworker?.caption ?? undefined,
  };
}

/** The shell reads no URL data; the profile streams in under it. */
export default function CoworkerProfilePage({
  params,
}: {
  params: Promise<{ coworkerId: string }>;
}) {
  return (
    <Suspense fallback={<AgentProfileSkeleton />}>
      <CoworkerProfile params={params} />
    </Suspense>
  );
}

async function CoworkerProfile({
  params,
}: {
  params: Promise<{ coworkerId: string }>;
}) {
  const [{ coworkerId }, t] = await Promise.all([
    params,
    getTranslations("App.Agents.Directory"),
  ]);
  const coworker = await findCoworker(coworkerId);
  if (!coworker) notFound();

  const profile = coworker.metadata?.profile;
  const offers = coworker.metadata?.offers ?? [];
  const works = [
    coworker.capabilities.includes("tasks") ? t("worksTasks") : null,
    coworker.capabilities.includes("chat") ? t("worksChat") : null,
  ].filter((value): value is string => value !== null);
  const about = [
    { label: t("aboutCompany"), value: coworker.vendor.name },
    coworker.caption
      ? { label: t("aboutRole"), value: coworker.caption }
      : null,
    works.length > 0
      ? { label: t("aboutWorks"), value: works.join(", ") }
      : null,
    profile?.llm?.length
      ? { label: t("aboutModels"), value: profile.llm.join(", ") }
      : null,
    profile?.hosting
      ? { label: t("aboutHosting"), value: profile.hosting }
      : null,
  ].filter((row) => row !== null);

  return (
    <AgentProfile
      backLabel={t("backToAgents")}
      avatar={
        <CoworkerAvatar coworker={coworker} className="size-20" sizes="80px" />
      }
      name={coworker.name}
      byline={t("byVendor", { vendor: coworker.vendor.name })}
      actions={<CoworkerActions coworker={coworker} />}
      sections={[
        Boolean(coworker.description || offers.length > 0) && {
          id: "what",
          title: t("sectionWhat"),
          content: (
            <div className="flex flex-col gap-6">
              {coworker.description ? (
                <p className="text-foreground text-sm leading-relaxed text-pretty">
                  {coworker.description}
                </p>
              ) : null}
              {offers.length > 0 ? (
                <div className="flex flex-col gap-3">
                  <h3 className="text-muted-foreground text-sm font-medium">
                    {t("readyTasks")}
                  </h3>
                  <CoworkerOffers coworker={coworker} />
                </div>
              ) : null}
            </div>
          ),
        },
        {
          id: "about",
          title: t("sectionAbout"),
          content: <AboutList rows={about} />,
        },
      ]}
    />
  );
}
